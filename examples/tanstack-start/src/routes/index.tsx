import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { authClient } from "../lib/auth-client";
import { notifyMe } from "../lib/notify";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return null;
  return session ? <Actions /> : <SignUp />;
}

function SignUp() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const { error } = await authClient.signUp.email({
          email,
          password,
          name: email.split("@")[0] ?? email,
        });
        setError(error?.message ?? null);
      }}
      style={{ display: "grid", gap: 8, maxWidth: 320 }}
    >
      <h1>Sign up</h1>
      <label>
        Email
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          minLength={8}
          required
        />
      </label>
      <button type="submit">Create account</button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

function Actions() {
  const [sent, setSent] = useState(0);
  return (
    <div style={{ display: "grid", gap: 8, maxWidth: 320 }}>
      <h1>Home</h1>
      <button
        type="button"
        onClick={async () => {
          await notifyMe();
          setSent((n) => n + 1);
        }}
      >
        Send me a notification
      </button>
      {sent > 0 ? <p role="status">Sent {sent}</p> : null}
      <button type="button" onClick={() => authClient.signOut()}>
        Sign out
      </button>
    </div>
  );
}
