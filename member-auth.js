(function () {
  "use strict";

  let client = null;
  let member = null;
  let enabled = false;
  let initialized = false;
  let changeHandler = null;

  const byId = id => document.getElementById(id);

  function setStatus(message, isError = false) {
    const status = byId("memberAuthStatus");
    if (!status) return;
    status.textContent = message || "";
    status.classList.toggle("error", Boolean(isError));
  }

  function setPanel(name) {
    document.querySelectorAll("[data-member-panel]").forEach(panel => {
      panel.hidden = panel.dataset.memberPanel !== name;
    });
    setStatus("");
  }

  function showModal(panel = member ? "account" : "signin") {
    setPanel(panel);
    const backdrop = byId("memberAuthBackdrop");
    if (backdrop) backdrop.hidden = false;
    requestAnimationFrame(() => {
      const selector = panel === "signin" ? "#memberEmail" : panel === "password" ? "#memberNewPassword" : null;
      document.querySelector(selector)?.focus();
    });
  }

  function hideModal() {
    const backdrop = byId("memberAuthBackdrop");
    if (backdrop) backdrop.hidden = true;
  }

  function paintAccountButton() {
    const button = byId("memberAccountBtn");
    if (!button) return;
    button.textContent = member ? "✓" : "👤";
    button.classList.toggle("memberActive", Boolean(member));
    button.setAttribute("aria-label", member ? `Member account: ${member.playerName}` : "Member sign in");
    button.title = member ? `${member.playerName} · ${member.email}` : "Member sign in";
  }

  function emit() {
    paintAccountButton();
    if (typeof changeHandler === "function") {
      changeHandler({ member, isMember: Boolean(member), isGuest: !member });
    }
  }

  async function session() {
    if (!client) return null;
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data?.session || null;
  }

  async function authorizedFetch(input, options = {}) {
    const activeSession = await session();
    if (!activeSession?.access_token) throw new Error("Member sign in required");
    const headers = new Headers(options.headers || {});
    headers.set("Authorization", `Bearer ${activeSession.access_token}`);
    return fetch(input, { ...options, headers });
  }

  async function verifyMembership() {
    const response = await authorizedFetch("/api/member-session", { cache: "no-store" });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok || !data?.member) {
      throw new Error(data?.error || "This account is not an active pool member.");
    }
    member = data.member;
    const label = byId("memberAccountIdentity");
    if (label) label.textContent = `${member.playerName} · ${member.email}`;
    emit();
    return member;
  }

  async function rejectUnapprovedSession(message) {
    member = null;
    await client?.auth.signOut({ scope: "local" }).catch(() => {});
    emit();
    showModal("signin");
    setStatus(message, true);
  }

  async function signIn(event) {
    event.preventDefault();
    if (!client) return setStatus("Member login is not configured yet.", true);
    const email = String(byId("memberEmail")?.value || "").trim();
    const password = String(byId("memberPassword")?.value || "");
    const button = byId("memberSignInBtn");
    if (button) button.disabled = true;
    setStatus("Signing in…");
    try {
      const { error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw error;
      await verifyMembership();
      if (byId("memberPassword")) byId("memberPassword").value = "";
      hideModal();
    } catch (error) {
      await rejectUnapprovedSession(error?.message || "Sign in failed.");
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function sendPasswordReset(event) {
    event.preventDefault();
    if (!client) return setStatus("Member login is not configured yet.", true);
    const email = String(byId("memberResetEmail")?.value || "").trim();
    const button = byId("memberResetBtn");
    if (button) button.disabled = true;
    setStatus("Sending reset email…");
    try {
      const redirectTo = `${location.origin}${location.pathname}?memberAuth=recovery`;
      const { error } = await client.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setStatus("If that address has an account, a reset link is on the way.");
    } catch (error) {
      setStatus(error?.message || "Could not send the reset email.", true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  async function updatePassword(event) {
    event.preventDefault();
    if (!client) return setStatus("Member login is not configured yet.", true);
    const password = String(byId("memberNewPassword")?.value || "");
    const confirmation = String(byId("memberConfirmPassword")?.value || "");
    if (password.length < 8) return setStatus("Use at least 8 characters.", true);
    if (password !== confirmation) return setStatus("The passwords do not match.", true);
    const button = byId("memberPasswordBtn");
    if (button) button.disabled = true;
    setStatus("Saving password…");
    try {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw error;
      await verifyMembership();
      history.replaceState({}, "", location.pathname + location.search.replace(/([?&])memberAuth=[^&]*&?/, "$1").replace(/[?&]$/, ""));
      hideModal();
    } catch (error) {
      setStatus(error?.message || "Could not save the password.", true);
    } finally {
      if (button) button.disabled = false;
    }
  }

  function continueAsGuest() {
    member = null;
    hideModal();
    emit();
  }

  async function signOut() {
    await client?.auth.signOut().catch(() => {});
    member = null;
    emit();
    showModal("signin");
  }

  function bindUi() {
    byId("memberSignInForm")?.addEventListener("submit", signIn);
    byId("memberResetForm")?.addEventListener("submit", sendPasswordReset);
    byId("memberPasswordForm")?.addEventListener("submit", updatePassword);
    byId("memberGuestBtn")?.addEventListener("click", continueAsGuest);
    byId("memberForgotBtn")?.addEventListener("click", () => {
      const resetEmail = byId("memberResetEmail");
      if (resetEmail) resetEmail.value = String(byId("memberEmail")?.value || "").trim();
      setPanel("reset");
    });
    document.querySelectorAll("[data-member-back]").forEach(button => button.addEventListener("click", () => setPanel(member ? "account" : "signin")));
    byId("memberAccountBtn")?.addEventListener("click", () => showModal(member ? "account" : "signin"));
    byId("memberAccountCloseBtn")?.addEventListener("click", hideModal);
    byId("memberSignOutBtn")?.addEventListener("click", signOut);
    byId("memberChangePasswordBtn")?.addEventListener("click", () => setPanel("password"));
  }

  async function init(options = {}) {
    if (initialized) return { member, enabled };
    initialized = true;
    changeHandler = options.onChange || null;
    bindUi();

    try {
      const initialHashType = new URLSearchParams(location.hash.replace(/^#/, "")).get("type");
      const initialQueryMode = new URLSearchParams(location.search).get("memberAuth");
      const response = await fetch("/api/member-auth-config", { cache: "no-store" });
      const config = await response.json().catch(() => ({}));
      if (!response.ok || !config?.enabled || !config?.url || !config?.publishableKey) throw new Error("Member login is not configured");
      if (!window.supabase?.createClient) throw new Error("Supabase Auth failed to load");
      enabled = true;
      client = window.supabase.createClient(config.url, config.publishableKey, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
      });

      client.auth.onAuthStateChange((event, activeSession) => {
        if (event === "PASSWORD_RECOVERY") {
          setTimeout(() => showModal("password"), 0);
        } else if (event === "SIGNED_OUT" && member) {
          setTimeout(() => {
            member = null;
            emit();
          }, 0);
        } else if (event === "TOKEN_REFRESHED" && activeSession && member) {
          paintAccountButton();
        }
      });

      const activeSession = await session();
      if (activeSession) {
        try {
          await verifyMembership();
          if (initialQueryMode === "recovery" || initialHashType === "invite" || initialHashType === "recovery") showModal("password");
          else hideModal();
        } catch (error) {
          await rejectUnapprovedSession(error?.message || "This account is not an active pool member.");
        }
      } else {
        showModal("signin");
        emit();
      }
    } catch (error) {
      enabled = false;
      member = null;
      hideModal();
      paintAccountButton();
      emit();
      console.warn(error?.message || error);
    }
    return { member, enabled };
  }

  window.MemberAuth = {
    init,
    isMember: () => Boolean(member),
    getMember: () => member,
    authorizedFetch,
    showSignIn: () => showModal(member ? "account" : "signin")
  };
})();
