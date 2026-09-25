-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SourceType" ADD VALUE 'CANVAS_FILE';
ALTER TYPE "SourceType" ADD VALUE 'CANVAS_PAGE';

-- CreateTable
CREATE TABLE "CanvasConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "baseUrl" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "canvasUserName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasConnection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CanvasConnection_userId_key" ON "CanvasConnection"("userId");

-- AddForeignKey
ALTER TABLE "CanvasConnection" ADD CONSTRAINT "CanvasConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

