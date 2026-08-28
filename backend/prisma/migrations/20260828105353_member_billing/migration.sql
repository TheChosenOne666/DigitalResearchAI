-- CreateEnum
CREATE TYPE "MemberLevel" AS ENUM ('FREE', 'PRO', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "PlanCycle" AS ENUM ('SINGLE', 'MONTHLY', 'YEAR');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'PAID', 'CANCELLED', 'CLOSED', 'FAILED');

-- CreateEnum
CREATE TYPE "PayChannel" AS ENUM ('MOCK', 'WECHAT', 'ALIPAY');

-- CreateTable
CREATE TABLE "member_plans" (
    "id" VARCHAR(32) NOT NULL,
    "code" VARCHAR(32) NOT NULL,
    "level" "MemberLevel" NOT NULL,
    "cycle" "PlanCycle" NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "tag" VARCHAR(64),
    "price_cents" INTEGER NOT NULL,
    "origin_price_cents" INTEGER,
    "badge" VARCHAR(32),
    "features" JSONB,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_subscriptions" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "level" "MemberLevel" NOT NULL DEFAULT 'FREE',
    "cycle" "PlanCycle",
    "expire_at" TIMESTAMP(3),
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "total_periods" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_orders" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "plan_id" VARCHAR(32) NOT NULL,
    "plan_snapshot" JSONB NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "channel" "PayChannel" NOT NULL DEFAULT 'MOCK',
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "pay_info" JSONB,
    "paid_at" TIMESTAMP(3),
    "expire_at" TIMESTAMP(3),
    "is_renewal" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "member_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_records" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "order_id" VARCHAR(32) NOT NULL,
    "order_no" VARCHAR(32) NOT NULL,
    "transaction_no" VARCHAR(64) NOT NULL,
    "channel" "PayChannel" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "raw_payload" JSONB,
    "status" VARCHAR(16) NOT NULL DEFAULT 'SUCCESS',
    "paid_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trial_quota" (
    "id" VARCHAR(32) NOT NULL,
    "tenant_id" VARCHAR(32) NOT NULL,
    "user_id" VARCHAR(32) NOT NULL,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trial_quota_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_plans_code_key" ON "member_plans"("code");

-- CreateIndex
CREATE UNIQUE INDEX "member_subscriptions_user_id_key" ON "member_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "member_subscriptions_tenant_id_expire_at_idx" ON "member_subscriptions"("tenant_id", "expire_at");

-- CreateIndex
CREATE UNIQUE INDEX "member_orders_order_no_key" ON "member_orders"("order_no");

-- CreateIndex
CREATE INDEX "member_orders_tenant_id_created_at_idx" ON "member_orders"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "member_orders_user_id_status_idx" ON "member_orders"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payment_records_transaction_no_key" ON "payment_records"("transaction_no");

-- CreateIndex
CREATE INDEX "payment_records_tenant_id_created_at_idx" ON "payment_records"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "payment_records_order_id_idx" ON "payment_records"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "trial_quota_user_id_key" ON "trial_quota"("user_id");
