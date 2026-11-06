-- Additive only. Existing xero_connections, xero_oauth_pending, xero_audit_logs
-- rows and the XeroConnectionStatus enum are left in place.

-- AlterTable
ALTER TABLE "xero_connections" ADD COLUMN "default_xero_user_id" TEXT;
ALTER TABLE "xero_connections" ADD COLUMN "default_xero_user_name" TEXT;
ALTER TABLE "xero_connections" ADD COLUMN "last_sync_error" TEXT;
ALTER TABLE "xero_connections" ADD COLUMN "last_time_push_at" TIMESTAMP(3);

-- CreateEnum
CREATE TYPE "XeroTimeSyncStatus" AS ENUM ('pending', 'synced', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "XeroProjectLinkMethod" AS ENUM ('manual', 'prefix', 'created');

-- CreateTable
CREATE TABLE "xero_project_links" (
    "id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "xero_project_id" TEXT NOT NULL,
    "xero_project_name" TEXT NOT NULL,
    "xero_contact_id" TEXT,
    "xero_task_id" TEXT,
    "method" "XeroProjectLinkMethod" NOT NULL,
    "linked_by_user_id" TEXT,
    "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "xero_project_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xero_time_syncs" (
    "id" TEXT NOT NULL,
    "time_entry_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "status" "XeroTimeSyncStatus" NOT NULL DEFAULT 'pending',
    "xero_time_id" TEXT,
    "xero_project_id" TEXT,
    "xero_tenant_id" TEXT,
    "xero_user_id" TEXT,
    "xero_task_id" TEXT,
    "user_match" TEXT,
    "duration_minutes" INTEGER,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMP(3),
    "synced_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "xero_time_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "xero_project_links_project_id_key" ON "xero_project_links"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "xero_project_links_company_id_xero_project_id_key" ON "xero_project_links"("company_id", "xero_project_id");

-- CreateIndex
CREATE INDEX "xero_project_links_company_id_idx" ON "xero_project_links"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "xero_time_syncs_time_entry_id_key" ON "xero_time_syncs"("time_entry_id");

-- CreateIndex
CREATE UNIQUE INDEX "xero_time_syncs_xero_time_id_key" ON "xero_time_syncs"("xero_time_id");

-- CreateIndex
CREATE INDEX "xero_time_syncs_company_id_status_idx" ON "xero_time_syncs"("company_id", "status");

-- AddForeignKey
ALTER TABLE "xero_project_links" ADD CONSTRAINT "xero_project_links_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xero_project_links" ADD CONSTRAINT "xero_project_links_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xero_project_links" ADD CONSTRAINT "xero_project_links_linked_by_user_id_fkey" FOREIGN KEY ("linked_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xero_time_syncs" ADD CONSTRAINT "xero_time_syncs_time_entry_id_fkey" FOREIGN KEY ("time_entry_id") REFERENCES "TimeEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
