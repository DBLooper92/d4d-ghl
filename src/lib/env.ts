export const Env = {
  server: {
    FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID ?? "",
    FIREBASE_CLIENT_EMAIL: process.env.FIREBASE_CLIENT_EMAIL ?? "",
    FIREBASE_PRIVATE_KEY: process.env.FIREBASE_PRIVATE_KEY ?? "",
  },
  client: {
    NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV ?? "dev",
  },
};

// Usage examples:
//   Env.server.FIREBASE_PROJECT_ID   // server-only
//   Env.client.NEXT_PUBLIC_APP_ENV   // safe for client
