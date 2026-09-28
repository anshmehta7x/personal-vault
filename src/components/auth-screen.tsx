"use client";

import { FormEvent, useState } from "react";
import { Fingerprint, KeyRound, ShieldCheck, Usb } from "lucide-react";
import { useRouter } from "next/navigation";

import { authClient } from "@/lib/auth/client";

import styles from "./auth-screen.module.css";

export function AuthScreen() {
  const router = useRouter();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupKey, setSetupKey] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [needsPasskey, setNeedsPasskey] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    const result = isSignUp
      ? await authClient.signUp.email(
        { email, password, name: "Vault owner" },
        { headers: { "x-vault-setup-key": setupKey } },
      )
      : await authClient.signIn.email({ email, password });

    setIsSubmitting(false);
    if (result.error) {
      setError(result.error.message ?? "Authentication failed.");
      return;
    }
    if (isSignUp) {
      setNeedsPasskey(true);
      return;
    }
    router.push("/vault");
  }

  async function signInWithPasskey(): Promise<void> {
    setError("");
    setIsSubmitting(true);
    const result = await authClient.signIn.passkey();
    setIsSubmitting(false);
    if (result.error) {
      setError(result.error.message ?? "Passkey authentication failed.");
      return;
    }
    router.push("/vault");
  }

  async function addPasskey(type: "platform" | "cross-platform"): Promise<void> {
    setError("");
    setIsSubmitting(true);
    const result = await authClient.passkey.addPasskey({
      name: type === "platform" ? "Primary device" : "Hardware security key",
      authenticatorAttachment: type,
    });
    setIsSubmitting(false);
    if (result.error) {
      setError(result.error.message ?? "Could not register the passkey.");
      return;
    }
    router.push("/vault");
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
          {needsPasskey ? (
            <>
              <p className={styles.eyebrow}>Account created</p>
              <h2>Add your passkey</h2>
              <p className={styles.subtle}>
                Choose this device&apos;s passkey or a physical FIDO2 security key.
              </p>
              <div className={styles.passkeyChoices}>
                <button
                  disabled={isSubmitting}
                  onClick={() => addPasskey("platform")}
                  type="button"
                >
                  <Fingerprint size={20} />
                  <span>
                    <strong>Device passkey</strong>
                    <small>Face ID, Touch ID, Windows Hello or device PIN</small>
                  </span>
                </button>
                <button
                  disabled={isSubmitting}
                  onClick={() => addPasskey("cross-platform")}
                  type="button"
                >
                  <Usb size={20} />
                  <span>
                    <strong>Hardware security key</strong>
                    <small>USB, NFC or Bluetooth FIDO2 key</small>
                  </span>
                </button>
              </div>
              {error ? <p className={styles.error}>{error}</p> : null}
              <p className={styles.setupNote}>Add a passkey to continue to the vault.</p>
            </>
          ) : (
            <>
              <p className={styles.eyebrow}>Private access</p>
              <h2>{isSignUp ? "Create your account" : "Welcome back"}</h2>
              <p className={styles.subtle}>
                {isSignUp
                  ? "This vault is intended for one owner."
                  : "Sign in to reach your encrypted vault."}
              </p>

              {!isSignUp ? (
                <button
                  className={styles.passkeyPrimary}
                  disabled={isSubmitting}
                  onClick={signInWithPasskey}
                  type="button"
                >
                  <Fingerprint size={20} /> Sign in with a passkey
                </button>
              ) : null}
              {!isSignUp ? (
                <div className={styles.divider}><span>or use password</span></div>
              ) : null}

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
                    minLength={12}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    type="password"
                    value={password}
                  />
                </label>
                {isSignUp ? (
                  <label>
                    One-time setup key
                    <input
                      autoComplete="off"
                      onChange={(event) => setSetupKey(event.target.value)}
                      required
                      type="password"
                      value={setupKey}
                    />
                  </label>
                ) : null}
                {error ? <p className={styles.error}>{error}</p> : null}
                <button className={styles.primary} disabled={isSubmitting} type="submit">
                  {isSubmitting ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
                </button>
              </form>

              <button
                className={styles.switcher}
                onClick={() => setIsSignUp((value) => !value)}
                type="button"
              >
                {isSignUp
                  ? "Already have an account? Sign in"
                  : "First time here? Create the account"}
              </button>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
