-- Company vehicle register, allocations, checks, defects, and day-use records.
-- Adds new enums and tables only. Does not alter or drop existing tables or data.

-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('van', 'pickup', 'car', 'tipper', 'plant_other');

-- CreateEnum
CREATE TYPE "VehicleFuelType" AS ENUM ('petrol', 'diesel', 'electric', 'hybrid', 'other');

-- CreateEnum
CREATE TYPE "VehicleStatus" AS ENUM ('active', 'off_road', 'sold');

-- CreateEnum
CREATE TYPE "VehicleCheckResult" AS ENUM ('pass', 'fail');

-- CreateEnum
CREATE TYPE "VehicleDefectStatus" AS ENUM ('open', 'resolved');

-- CreateTable
CREATE TABLE "vehicles" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "registration" TEXT NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "colour" TEXT NOT NULL,
    "fuel_type" "VehicleFuelType" NOT NULL,
    "vin" TEXT,
    "mot_due" DATE,
    "road_tax_due" DATE,
    "insurance_expiry" DATE,
    "service_due_date" DATE,
    "service_due_mileage" INTEGER,
    "current_mileage" INTEGER,
    "notes" TEXT,
    "status" "VehicleStatus" NOT NULL DEFAULT 'active',
    "photo_url" TEXT,
    "project_id" TEXT,
    "archived_at" TIMESTAMP(3),
    "compliance_notified_on" DATE,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_allocations" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "project_id" TEXT,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "assigned_by_user_id" TEXT NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "ended_by_user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_checks" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "mileage" INTEGER NOT NULL,
    "has_defects" BOOLEAN NOT NULL,
    "unsafe" BOOLEAN NOT NULL DEFAULT false,
    "result" "VehicleCheckResult" NOT NULL,
    "notes" TEXT,
    "checked_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_defects" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "check_id" TEXT NOT NULL,
    "notes" TEXT NOT NULL,
    "status" "VehicleDefectStatus" NOT NULL DEFAULT 'open',
    "resolved_by_user_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "resolution_notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicle_defects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_day_uses" (
    "id" TEXT NOT NULL,
    "vehicle_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "used_on" DATE NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_day_uses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_company_id_registration_key" ON "vehicles"("company_id", "registration");

-- CreateIndex
CREATE INDEX "vehicles_company_id_idx" ON "vehicles"("company_id");

-- CreateIndex
CREATE INDEX "vehicles_company_id_status_idx" ON "vehicles"("company_id", "status");

-- CreateIndex
CREATE INDEX "vehicle_allocations_vehicle_id_idx" ON "vehicle_allocations"("vehicle_id");

-- CreateIndex
CREATE INDEX "vehicle_allocations_user_id_idx" ON "vehicle_allocations"("user_id");

-- CreateIndex
CREATE INDEX "vehicle_allocations_vehicle_id_ended_at_idx" ON "vehicle_allocations"("vehicle_id", "ended_at");

-- CreateIndex
CREATE INDEX "vehicle_checks_vehicle_id_checked_on_idx" ON "vehicle_checks"("vehicle_id", "checked_on");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_defects_check_id_key" ON "vehicle_defects"("check_id");

-- CreateIndex
CREATE INDEX "vehicle_defects_vehicle_id_status_idx" ON "vehicle_defects"("vehicle_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "vehicle_day_uses_vehicle_id_used_on_key" ON "vehicle_day_uses"("vehicle_id", "used_on");

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_allocations" ADD CONSTRAINT "vehicle_allocations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_allocations" ADD CONSTRAINT "vehicle_allocations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_allocations" ADD CONSTRAINT "vehicle_allocations_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_allocations" ADD CONSTRAINT "vehicle_allocations_assigned_by_user_id_fkey" FOREIGN KEY ("assigned_by_user_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_allocations" ADD CONSTRAINT "vehicle_allocations_ended_by_user_id_fkey" FOREIGN KEY ("ended_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_checks" ADD CONSTRAINT "vehicle_checks_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_checks" ADD CONSTRAINT "vehicle_checks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_defects" ADD CONSTRAINT "vehicle_defects_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_defects" ADD CONSTRAINT "vehicle_defects_check_id_fkey" FOREIGN KEY ("check_id") REFERENCES "vehicle_checks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_defects" ADD CONSTRAINT "vehicle_defects_resolved_by_user_id_fkey" FOREIGN KEY ("resolved_by_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_day_uses" ADD CONSTRAINT "vehicle_day_uses_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_day_uses" ADD CONSTRAINT "vehicle_day_uses_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
