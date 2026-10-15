import { betterAuth } from "better-auth";
import { tanstackStartCookies } from "better-auth/tanstack-start";
import { authOptions } from "./auth-options";

export const auth = betterAuth({
  ...authOptions,
  // tanstackStartCookies goes last so it sees cookies the others set
  plugins: [...authOptions.plugins, tanstackStartCookies()],
});
