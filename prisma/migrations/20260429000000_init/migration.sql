-- CreateTable
CREATE TABLE "public_form_logs" (
    "id" UUID NOT NULL,
    "public_token" TEXT NOT NULL,
    "submission_id" TEXT,
    "form_payload" JSONB NOT NULL,
    "form_payload_size" INTEGER NOT NULL,
    "landing_page_url" TEXT,
    "referer" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "utm_source" TEXT,
    "utm_medium" TEXT,
    "utm_campaign" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "public_form_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_form_logs_submission_id_key" ON "public_form_logs"("submission_id");

-- CreateIndex
CREATE INDEX "public_form_logs_public_token_idx" ON "public_form_logs"("public_token");

-- CreateIndex
CREATE INDEX "public_form_logs_created_at_idx" ON "public_form_logs"("created_at");

-- CreateIndex
CREATE INDEX "public_form_logs_public_token_created_at_idx" ON "public_form_logs"("public_token", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");
