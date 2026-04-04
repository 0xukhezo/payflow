-- PayFlow — Supabase Schema
-- Run this once in the Supabase SQL editor to set up all tables.
-- Safe to re-run: every statement uses IF NOT EXISTS / IF NOT EXISTS guards.

-- ── companies ─────────────────────────────────────────────────────────────────
-- One row per company. wallet_address is the treasury that holds USDC.

create table if not exists companies (
  id             uuid        primary key default gen_random_uuid(),
  name           text        not null,
  email          text        not null,
  payment_asset  text        not null default 'usdc',
  chain_id       integer     not null default 11155111,
  wallet_address text        not null,
  created_at     timestamptz not null default now()
);

create index if not exists companies_wallet_address_idx on companies (lower(wallet_address));
create index if not exists companies_name_idx           on companies (lower(name));

-- ── employees ─────────────────────────────────────────────────────────────────
-- One row per employee per company.
-- world_id_verified is set true after World ID proof validation.
-- solana_address is only populated for employees receiving SOL.

create table if not exists employees (
  id                 uuid        primary key default gen_random_uuid(),
  company_id         uuid        not null references companies(id) on delete cascade,
  name               text        not null,
  email              text,
  preferred_asset    text        not null default 'usdc',
  preferred_chain_id integer     not null default 11155111,
  settle_address     text        not null,
  solana_address     text,
  salary_amount      numeric     not null default 0,
  world_id_verified  boolean     not null default false,
  nullifier_hash     text,
  added_at           timestamptz not null default now()
);

create index if not exists employees_company_id_idx     on employees (company_id);
create index if not exists employees_settle_address_idx on employees (lower(settle_address));
create index if not exists employees_solana_address_idx on employees (lower(solana_address));

-- ── payroll_splits ────────────────────────────────────────────────────────────
-- Optional per-employee splits. When present and summing to 100%, the backend
-- distributes the salary across these splits instead of using preferred_asset.
-- settle_address overrides the employee's default settle_address for this split.

create table if not exists payroll_splits (
  id             uuid        primary key default gen_random_uuid(),
  employee_id    uuid        not null references employees(id) on delete cascade,
  percent        numeric     not null,
  asset          text        not null,
  chain_id       integer     not null,
  settle_address text,
  created_at     timestamptz not null default now()
);

create index if not exists payroll_splits_employee_id_idx on payroll_splits (employee_id);

-- ── payroll_runs ──────────────────────────────────────────────────────────────
-- One row per payment unit per payroll run.
-- id is the Uniswap txHash (0x…) or SideShift orderId.
-- Two-hop runs write swap_tx_hash + transfer_tx_hash after the second hop settles.

create table if not exists payroll_runs (
  id               text        primary key,
  employee_id      uuid        references employees(id) on delete set null,
  company_id       uuid        references companies(id) on delete set null,
  settle_address   text        not null,
  deposit_asset    text        not null,
  deposit_chain_id integer     not null default 11155111,
  deposit_amount   numeric     not null,
  settle_asset     text        not null,
  settle_chain_id  integer     not null default 11155111,
  settle_amount    numeric,
  is_cross_chain   boolean     not null default false,
  swap_tx_hash     text,
  transfer_tx_hash text,
  provider         text,
  status           text        not null default 'processing',
  created_at       timestamptz not null default now()
);

create index if not exists payroll_runs_settle_address_idx on payroll_runs (lower(settle_address));
create index if not exists payroll_runs_employee_id_idx    on payroll_runs (employee_id);
create index if not exists payroll_runs_company_id_idx     on payroll_runs (company_id);
create index if not exists payroll_runs_created_at_idx     on payroll_runs (created_at desc);

-- ── join_requests ─────────────────────────────────────────────────────────────
-- Employee-initiated join flow. Company reviews and accepts/rejects.
-- ens_splits stores the employee's on-chain split config from their ENS record,
-- applied automatically when the company accepts the request.

create table if not exists join_requests (
  id                 uuid        primary key default gen_random_uuid(),
  company_id         uuid        not null references companies(id) on delete cascade,
  employee_name      text        not null,
  employee_address   text        not null,
  preferred_asset    text        not null default 'usdc',
  preferred_chain_id integer     not null default 11155111,
  ens_name           text,
  solana_address     text,
  ens_splits         jsonb,
  status             text        not null default 'pending'
                     check (status in ('pending', 'accepted', 'rejected')),
  created_at         timestamptz not null default now()
);

create index if not exists join_requests_company_id_idx      on join_requests (company_id);
create index if not exists join_requests_status_idx          on join_requests (status);
create index if not exists join_requests_employee_address_idx on join_requests (lower(employee_address));

-- ── world_id_verifications ────────────────────────────────────────────────────
-- Pre-verification records for wallets that completed World ID before joining
-- a company. Checked when a company accepts a join request.

create table if not exists world_id_verifications (
  address        text        primary key,
  nullifier_hash text,
  created_at     timestamptz not null default now()
);
