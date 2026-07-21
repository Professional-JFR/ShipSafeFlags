import { Pool } from "pg";
import { AuditRecord, Environment, FlagConfig, FlagEnvironmentState, FlagRecord } from "./types.js";

export interface Repository {
  listFlags(): Promise<FlagRecord[]>;
  getFlag(key: string): Promise<FlagRecord | null>;
  createFlag(input: { key: string; name: string; description: string; actor: string; envConfigs: Partial<Record<Environment, FlagConfig>> }): Promise<FlagRecord>;
  updateFlagEnvironment(input: {
    key: string;
    environment: Environment;
    expectedVersion: number;
    actor: string;
    reason: string;
    config: FlagConfig;
  }): Promise<FlagEnvironmentState>;
  getAudit(key: string): Promise<AuditRecord[]>;
}

const defaultConfig = (key: string, environment: Environment): FlagConfig => ({
  enabled: false,
  killSwitch: false,
  allowlist: [],
  denylist: [],
  attributeRules: [],
  percentageRollout: 0,
  salt: `${key}-${environment}`
});

type FlagJoinRow = {
  key: string;
  name: string;
  description: string;
  created_at: Date;
  updated_at: Date;
  environment: Environment;
  version: number;
  env_updated_at: Date;
  updated_by: string;
  config: FlagConfig;
};

function mapFlagRows(rows: FlagJoinRow[]): FlagRecord[] {
  const byKey = new Map<string, FlagRecord>();
  for (const row of rows) {
    if (!byKey.has(row.key)) {
      byKey.set(row.key, {
        key: row.key,
        name: row.name,
        description: row.description,
        createdAt: row.created_at.toISOString(),
        updatedAt: row.updated_at.toISOString(),
        environments: {} as FlagRecord["environments"]
      });
    }
    byKey.get(row.key)!.environments[row.environment as Environment] = {
      environment: row.environment,
      version: row.version,
      updatedAt: row.env_updated_at.toISOString(),
      updatedBy: row.updated_by,
      config: row.config
    };
  }
  return [...byKey.values()];
}

export class PgRepository implements Repository {
  constructor(private readonly pool: Pool) {}

  async listFlags(): Promise<FlagRecord[]> {
    const { rows } = await this.pool.query<FlagJoinRow>(
      `select f.key, f.name, f.description, f.created_at, f.updated_at,
              e.environment, e.version, e.updated_at as env_updated_at, e.updated_by, e.config
       from flags f
       join flag_environment_configs e on e.flag_key = f.key
       order by f.key asc, e.environment asc`
    );
    return mapFlagRows(rows);
  }

  async getFlag(key: string): Promise<FlagRecord | null> {
    const { rows } = await this.pool.query<FlagJoinRow>(
      `select f.key, f.name, f.description, f.created_at, f.updated_at,
              e.environment, e.version, e.updated_at as env_updated_at, e.updated_by, e.config
       from flags f
       join flag_environment_configs e on e.flag_key = f.key
       where f.key = $1`,
      [key]
    );
    const mapped = mapFlagRows(rows);
    return mapped[0] ?? null;
  }

  async createFlag(input: { key: string; name: string; description: string; actor: string; envConfigs: Partial<Record<Environment, FlagConfig>> }): Promise<FlagRecord> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      await client.query(`insert into flags(key,name,description,created_by,updated_by) values ($1,$2,$3,$4,$4)`, [input.key, input.name, input.description, input.actor]);
      for (const environment of ["dev", "staging", "prod"] as const) {
        const config = input.envConfigs[environment] ?? defaultConfig(input.key, environment);
        await client.query(
          `insert into flag_environment_configs(flag_key, environment, config, version, updated_by)
           values($1,$2,$3::jsonb,1,$4)`,
          [input.key, environment, JSON.stringify(config), input.actor]
        );
        await client.query(
          `insert into flag_environment_audit(flag_key, environment, version, actor, action, reason, before_config, after_config)
           values($1,$2,1,$3,'create','initial create',null,$4::jsonb)`,
          [input.key, environment, input.actor, JSON.stringify(config)]
        );
      }
      await client.query("commit");
      return (await this.getFlag(input.key)) as FlagRecord;
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async updateFlagEnvironment(input: {
    key: string;
    environment: Environment;
    expectedVersion: number;
    actor: string;
    reason: string;
    config: FlagConfig;
  }): Promise<FlagEnvironmentState> {
    const client = await this.pool.connect();
    try {
      await client.query("begin");
      const existing = await client.query(
        `select version, config, updated_at
         from flag_environment_configs
         where flag_key=$1 and environment=$2
         for update`,
        [input.key, input.environment]
      );
      if (existing.rowCount === 0) throw new Error("not_found");
      const current = existing.rows[0];
      if (current.version !== input.expectedVersion) {
        throw new Error(`version_conflict:${current.version}`);
      }

      const nextVersion = current.version + 1;
      await client.query(
        `update flag_environment_configs
         set config=$1::jsonb, version=$2, updated_by=$3, updated_at=now()
         where flag_key=$4 and environment=$5`,
        [JSON.stringify(input.config), nextVersion, input.actor, input.key, input.environment]
      );
      await client.query(`update flags set updated_at=now(), updated_by=$1 where key=$2`, [input.actor, input.key]);
      await client.query(
        `insert into flag_environment_audit(flag_key, environment, version, actor, action, reason, before_config, after_config)
         values($1,$2,$3,$4,'update',$5,$6::jsonb,$7::jsonb)`,
        [input.key, input.environment, nextVersion, input.actor, input.reason, JSON.stringify(current.config), JSON.stringify(input.config)]
      );
      await client.query("commit");
      return {
        environment: input.environment,
        version: nextVersion,
        updatedAt: new Date().toISOString(),
        updatedBy: input.actor,
        config: input.config
      };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getAudit(key: string): Promise<AuditRecord[]> {
    const { rows } = await this.pool.query<FlagJoinRow>(
      `select id, flag_key, environment, version, actor, action, reason, before_config, after_config, created_at
       from flag_environment_audit
       where flag_key=$1
       order by id desc`,
      [key]
    );
    return rows.map((row: any) => ({
      id: row.id,
      flagKey: row.flag_key,
      environment: row.environment,
      version: row.version,
      actor: row.actor,
      action: row.action,
      reason: row.reason,
      beforeConfig: row.before_config,
      afterConfig: row.after_config,
      createdAt: row.created_at.toISOString()
    }));
  }
}

export class MemoryRepository implements Repository {
  private flags = new Map<string, FlagRecord>();
  private audit: AuditRecord[] = [];
  private nextAuditId = 1;

  async listFlags(): Promise<FlagRecord[]> {
    return [...this.flags.values()];
  }

  async getFlag(key: string): Promise<FlagRecord | null> {
    return this.flags.get(key) ?? null;
  }

  async createFlag(input: { key: string; name: string; description: string; actor: string; envConfigs: Partial<Record<Environment, FlagConfig>> }): Promise<FlagRecord> {
    if (this.flags.has(input.key)) throw new Error("duplicate");
    const now = new Date().toISOString();
    const environments = {
      dev: {
        environment: "dev" as const,
        version: 1,
        updatedAt: now,
        updatedBy: input.actor,
        config: input.envConfigs.dev ?? defaultConfig(input.key, "dev")
      },
      staging: {
        environment: "staging" as const,
        version: 1,
        updatedAt: now,
        updatedBy: input.actor,
        config: input.envConfigs.staging ?? defaultConfig(input.key, "staging")
      },
      prod: {
        environment: "prod" as const,
        version: 1,
        updatedAt: now,
        updatedBy: input.actor,
        config: input.envConfigs.prod ?? defaultConfig(input.key, "prod")
      }
    };
    const flag: FlagRecord = {
      key: input.key,
      name: input.name,
      description: input.description,
      createdAt: now,
      updatedAt: now,
      environments
    };
    this.flags.set(input.key, flag);
    for (const env of ["dev", "staging", "prod"] as const) {
      this.audit.push({
        id: this.nextAuditId++,
        flagKey: input.key,
        environment: env,
        version: 1,
        actor: input.actor,
        action: "create",
        reason: "initial create",
        beforeConfig: null,
        afterConfig: environments[env].config,
        createdAt: now
      });
    }
    return flag;
  }

  async updateFlagEnvironment(input: {
    key: string;
    environment: Environment;
    expectedVersion: number;
    actor: string;
    reason: string;
    config: FlagConfig;
  }): Promise<FlagEnvironmentState> {
    const flag = this.flags.get(input.key);
    if (!flag) throw new Error("not_found");
    const current = flag.environments[input.environment];
    if (current.version !== input.expectedVersion) throw new Error(`version_conflict:${current.version}`);
    const next = {
      ...current,
      version: current.version + 1,
      updatedAt: new Date().toISOString(),
      updatedBy: input.actor,
      config: input.config
    };
    flag.environments[input.environment] = next;
    flag.updatedAt = next.updatedAt;
    this.audit.unshift({
      id: this.nextAuditId++,
      flagKey: input.key,
      environment: input.environment,
      version: next.version,
      actor: input.actor,
      action: "update",
      reason: input.reason,
      beforeConfig: current.config,
      afterConfig: input.config,
      createdAt: next.updatedAt
    });
    return next;
  }

  async getAudit(key: string): Promise<AuditRecord[]> {
    return this.audit.filter((a) => a.flagKey === key).sort((a, b) => b.id - a.id);
  }
}
