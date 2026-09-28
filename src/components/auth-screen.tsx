"use client";

import { FormEvent, useState } from "react";
import { KeyRound, ShieldCheck } from "lucide-react";

import { authClient } from "@/lib/auth/client";

import styles from "./auth-screen.module.css";

export function AuthScreen() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const result = isSignUp
      ? await authClient.signUp.email({ email, password, name: "Vault owner" })
      : await authClient.signIn.email({ email, password });

    setIsSubmitting(false);
    if (result.error) {
      setError(result.error.message ?? "Authentication failed.");
      return;
    }
    window.location.assign("/vault");
  }

  return (
    <main className={styles.page}>
      <section className={styles.intro}>
        <div className={styles.brand}>
          <span className={styles.logo}><ShieldCheck size={24} /></span>
          <span>Locker</span>
        </div>
        <div>
          <p className={styles.eyebrow}>Your private digital drawer</p>
          <h1>Everything important.<br />Encrypted before it leaves your device.</h1>
          <p className={styles.copy}>
            Keep IDs, bank details, personal records and documents together without giving
            the server the keys to read them.
          </p>
        </div>
        <div className={styles.securityNote}>
          <KeyRound size={18} />
          <span>Account login and a separate vault passphrase protect your data.</span>
        </div>
      </section>

      <section className={styles.panel}>
        <div className={styles.card}>
          <p className={styles.eyebrow}>Private access</p>
          <h2>{isSignUp ? "Create your account" : "Welcome back"}</h2>
          <p className={styles.subtle}>
            {isSignUp ? "This vault is intended for one owner." : "Sign in to reach your encrypted vault."}
          </p>

          <form onSubmit={handleSubmit} className={styles.form}>
            <label>
              Email
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <label>
              Account password
              <input
                autoComplete={isSignUp ? "new-password" : "current-password"}
                minLength={10}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            {error ? <p className={styles.error}>{error}</p> : null}
            <button className={styles.primary} disabled={isSubmitting} type="submit">
              {isSubmitting ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
            </button>
          </form>

          <button className={styles.switcher} onClick={() => setIsSignUp((value) => !value)} type="button">
            {isSignUp ? "Already have an account? Sign in" : "First time here? Create the account"}
          </button>
        </div>
      </section>
    </main>
  );
}
