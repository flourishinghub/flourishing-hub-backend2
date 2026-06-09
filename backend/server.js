import { app } from "./app.js";
import { env } from "./config/index.js";
import { prisma } from "./database/prisma.js";
import { startReminderCron } from "./cron/reminder.cron.js";

let server;

const shutdown = async (signal) => {
  console.log(`Received ${signal}. Closing gracefully...`);
  if (server) {
    server.close(async () => {
      await prisma.$disconnect();
      process.exit(0);
    });
    return;
  }

  await prisma.$disconnect();
  process.exit(0);
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

const start = async () => {
  try {
    await prisma.$connect();
    console.log("Database connection established");

    server = app.listen(env.PORT, () => {
      console.log(`${env.APP_NAME} listening on port ${env.PORT}`);
    });

    startReminderCron();

    server.on("error", async (error) => {
      if (error.code === "EADDRINUSE") {
        console.error(`Port ${env.PORT} is already in use`);
      } else {
        console.error("Server failed to start", error);
      }

      await prisma.$disconnect();
      process.exit(1);
    });
  } catch (error) {
    console.error("Failed to connect to the database", error);
    await prisma.$disconnect();
    process.exit(1);
  }
};

void start();


