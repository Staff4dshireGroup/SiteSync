import 'dotenv/config';
import { createServer } from 'http';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (recovered):', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (recovered):', err.message);
});
import { Server } from 'socket.io';
import { createApp } from './app';
import { corsOrigin } from './corsConfig';
import { verifyToken } from './middleware/auth';
import { prisma } from './db';
import { startXeroTokenRefreshJob } from './jobs/xeroTokenRefreshJob';
import { startOnboardingReminderJob } from './jobs/onboardingReminderJob';
import { startVehicleComplianceJob } from './jobs/vehicleComplianceJob';

const REQUESTED_PORT = Number(process.env.PORT) || 3001;
const AUTO_FALLBACK_ENABLED = (process.env.PORT_AUTO_FALLBACK ?? 'true') !== 'false';
const MAX_PORT_ATTEMPTS = Number(process.env.PORT_MAX_ATTEMPTS ?? 20);

const app = createApp();
const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: corsOrigin(), credentials: true },
});

app.set('io', io);

io.use((socket, next) => {
  const token = socket.handshake.auth?.token as string | undefined;
  if (!token) {
    return next(new Error('Authentication required'));
  }
  try {
    const { sub } = verifyToken(token);
    (socket.data as { userId: string }).userId = sub;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const userId = (socket.data as { userId: string }).userId;
  socket.join(`user:${userId}`);

  socket.on('join-user-room', (uid: string) => {
    if (uid === userId) socket.join(`user:${uid}`);
  });

  socket.on('join-conversation', (conversationId: string) => {
    socket.join(`conversation:${conversationId}`);
  });

  socket.on('leave-conversation', (conversationId: string) => {
    socket.leave(`conversation:${conversationId}`);
  });

  socket.on('typing', (payload: { conversationId: string; userId?: string }) => {
    socket.to(`conversation:${payload.conversationId}`).emit('user-typing', {
      userId,
      conversationId: payload.conversationId,
    });
  });

  socket.on('stop-typing', (payload: { conversationId: string }) => {
    socket.to(`conversation:${payload.conversationId}`).emit('user-stopped-typing', {
      userId,
      conversationId: payload.conversationId,
    });
  });
});

function startServer(port: number, attemptsLeft: number) {
  const onError = (error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE' && AUTO_FALLBACK_ENABLED && attemptsLeft > 0) {
      const nextPort = port + 1;
      console.warn(
        `Port ${port} is busy. Retrying on ${nextPort} (${attemptsLeft} attempt${
          attemptsLeft === 1 ? '' : 's'
        } left)...`,
      );
      setTimeout(() => startServer(nextPort, attemptsLeft - 1), 0);
      return;
    }

    console.error(`Failed to start backend on port ${port}:`, error);
    process.exit(1);
  };

  httpServer.once('error', onError);
  httpServer.listen(port, () => {
    httpServer.off('error', onError);
    const address = httpServer.address();
    const activePort = typeof address === 'object' && address ? address.port : port;
    console.log(`API + Socket.io listening on http://localhost:${activePort}`);
    console.log(`Health: http://localhost:${activePort}/health`);
    console.log(
      `Set EXPO_PUBLIC_API_URL=http://localhost:${activePort}/api and EXPO_PUBLIC_SOCKET_URL=http://localhost:${activePort}`,
    );
    startXeroTokenRefreshJob();
    startOnboardingReminderJob(prisma, io);
    startVehicleComplianceJob(prisma, io);
  });
}

startServer(REQUESTED_PORT, MAX_PORT_ATTEMPTS);
