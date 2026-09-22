import { useState, type FormEvent } from "react";
import { ArrowUpRight, Check, Hash, MessageCircle, Users } from "lucide-react";
import { api, setToken } from "../lib/api";
import type { User } from "../lib/types";
import { Brand } from "../components/Common";
export function AuthPage({ onLogin }: { onLogin: (user: User) => void }) {
  const params = new URLSearchParams(location.search);
  const action = params.get("action");
  const [mode, setMode] = useState(
    action === "reset" ? "reset" : action === "verify" ? "verify" : "login",
  );
  const [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    const data = Object.fromEntries(new FormData(e.currentTarget));
    try {
      if (mode === "forgot") {
        await api("/auth/forgot-password", "POST", data);
        setNotice("If that account exists, a recovery link has been sent.");
      } else if (mode === "reset") {
        await api("/auth/reset-password", "POST", {
          token: params.get("token"),
          password: data.password,
        });
        history.replaceState(null, "", "/");
        setMode("login");
        setNotice("Password updated. Sign in with your new password.");
      } else if (mode === "verify") {
        await api("/auth/verify-email", "POST", { token: params.get("token") });
        history.replaceState(null, "", "/");
        setMode("login");
        setNotice("Email verified. You’re ready to sign in.");
      } else {
        const session = await api<{ accessToken: string; user: User }>(
          "/auth/" + mode,
          "POST",
          { ...data, ageConfirmed: data.ageConfirmed === "on" },
        );
        setToken(session.accessToken);
        onLogin(session.user);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-page">
      <aside className="auth-story">
        <div className="wordmark">
          <Brand />
          <span>gather</span>
        </div>
        <div className="story-copy">
          <span className="eyebrow">YOUR PEOPLE. YOUR PLACE.</span>
          <h1>
            A little space.
            <br />A lot of connection.
          </h1>
          <p>
            For the communities you’re building.
            <br />
            And the people who make them yours.
          </p>
          <div className="story-features">
            <span>
              <Hash size={18} />
              Rooms for your shared interests
            </span>
            <span>
              <MessageCircle size={18} />
              Conversations that feel closer
            </span>
            <span>
              <Users size={18} />A place where you belong
            </span>
          </div>
        </div>
        <div className="story-footer">
          <span className="small-orbit">✳</span>
          <span>Good things happen when we gather.</span>
        </div>
      </aside>
      <main className="auth-main">
        <div className="auth-top">
          <span>
            {mode === "register"
              ? "Already part of Gather?"
              : "New around here?"}
          </span>
          <button
            className="text-button"
            onClick={() => {
              setMode(mode === "register" ? "login" : "register");
              setError("");
              setNotice("");
            }}
          >
            {mode === "register" ? "Sign in" : "Create an account"}{" "}
            <ArrowUpRight size={15} />
          </button>
        </div>
        <div className="auth-form-wrap">
          <div className="mini-mark">
            <MessageCircle size={26} />
          </div>
          <h2>
            {mode === "register"
              ? "Find your people."
              : mode === "forgot"
                ? "Let’s get you back in."
                : mode === "reset"
                  ? "A fresh start."
                  : mode === "verify"
                    ? "Make it official."
                    : "Welcome back."}
          </h2>
          <p className="auth-description">
            {mode === "register"
              ? "Your next great conversation starts here."
              : mode === "forgot"
                ? "Enter your email to request a password reset."
                : mode === "reset"
                  ? "Choose a new password for your account."
                  : mode === "verify"
                    ? "Confirm your email address to finish setting up."
                    : "Pick up where the conversation left off."}
          </p>
          <form onSubmit={submit}>
            {mode === "register" && (
              <>
                <label>
                  Display name
                  <input
                    name="displayName"
                    placeholder="What should we call you?"
                    required
                    maxLength={60}
                    autoComplete="name"
                  />
                </label>
                <label>
                  Email address
                  <input
                    name="email"
                    type="email"
                    placeholder="you@example.com"
                    required
                    autoComplete="email"
                  />
                </label>
                <label>
                  Username
                  <input
                    name="username"
                    placeholder="your.unique.name"
                    required
                    minLength={3}
                    maxLength={20}
                    pattern="[a-zA-Z0-9_.]{3,20}"
                    autoComplete="username"
                  />
                  <small>
                    3–20 characters. Letters, numbers, dots and underscores.
                  </small>
                </label>
              </>
            )}
            {mode === "login" && (
              <label>
                Username or email
                <input
                  autoFocus
                  name="login"
                  placeholder="you@example.com"
                  required
                  autoComplete="username"
                />
              </label>
            )}
            {mode === "forgot" && (
              <label>
                Email address
                <input
                  autoFocus
                  name="email"
                  type="email"
                  required
                  placeholder="you@example.com"
                />
              </label>
            )}
            {["login", "register", "reset"].includes(mode) && (
              <label>
                Password
                <input
                  name="password"
                  type="password"
                  placeholder={
                    mode === "login"
                      ? "Enter your password"
                      : "At least 10 characters"
                  }
                  required
                  minLength={mode === "login" ? 1 : 10}
                  maxLength={128}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                />
              </label>
            )}
            {mode === "login" && (
              <button
                type="button"
                className="forgot text-button"
                onClick={() => setMode("forgot")}
              >
                Forgot password?
              </button>
            )}
            {mode === "register" && (
              <label className="check-label">
                <input type="checkbox" name="ageConfirmed" required />
                <span>
                  I’m at least 13 years old and will treat others with respect.
                </span>
              </label>
            )}
            {error && (
              <div role="alert" className="form-error">
                {error}
              </div>
            )}
            {notice && (
              <div role="status" className="form-notice">
                <Check size={16} />
                {notice}
              </div>
            )}
            <button className="primary full" disabled={busy}>
              {busy
                ? "One moment…"
                : mode === "register"
                  ? "Create your account"
                  : mode === "forgot"
                    ? "Send recovery link"
                    : mode === "reset"
                      ? "Save password"
                      : mode === "verify"
                        ? "Verify email"
                        : "Sign in to Gather"}
              <ArrowUpRight size={18} />
            </button>
          </form>
          {!["login", "register"].includes(mode) && (
            <button
              className="text-button back-login"
              onClick={() => {
                setMode("login");
                setNotice("");
              }}
            >
              Back to sign in
            </button>
          )}
          <p className="auth-footnote">
            A calmer place for real conversations.
          </p>
        </div>
        <footer className="auth-bottom">
          © {new Date().getFullYear()} Gather <span>Made for connection.</span>
        </footer>
      </main>
    </div>
  );
}
