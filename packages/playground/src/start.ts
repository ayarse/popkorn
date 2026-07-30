import { clerkMiddleware } from "@clerk/tanstack-react-start/server";
import { createStart } from "@tanstack/react-start";

// Clerk's `auth()` reads the request off the global start context, so the
// middleware has to run for every request — server functions included.
export const startInstance = createStart(() => ({
  requestMiddleware: [clerkMiddleware()],
}));
