-- AlterTable
ALTER TABLE "users" ADD COLUMN "username" VARCHAR(64),
ADD COLUMN "real_name" VARCHAR(64),
ADD COLUMN "organization" VARCHAR(128);

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
