-- CreateTable
CREATE TABLE "Connection" (
    "id" TEXT NOT NULL,
    "googleAccountSub" TEXT NOT NULL,
    "googleRefreshToken" TEXT NOT NULL,
    "calendarId" TEXT,
    "attioWebhookId" TEXT,
    "attioWebhookSecret" TEXT,
    "workspaceSlug" TEXT,
    "timezone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Binding" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "calendarId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "etag" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Binding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Connection_googleAccountSub_key" ON "Connection"("googleAccountSub");

-- CreateIndex
CREATE UNIQUE INDEX "Binding_taskId_key" ON "Binding"("taskId");

