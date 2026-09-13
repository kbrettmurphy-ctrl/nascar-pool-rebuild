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
    const card = document.querySelector(".memberAuthCard");
    const titleByPanel = {
      signin: "memberAuthTitle",
      reset: "memberResetTitle",
      password: "memberPasswordTitle",
      account: "memberProfileName"
    };
    if (card && titleByPanel[name]) card.setAttribute("aria-labelledby", titleByPanel[name]);
    setStatus("");
  }

  function setPasswordMode(isAccountChange) {
    const wrap = byId("memberCurrentPasswordWrap");
    const current = byId("memberCurrentPassword");
    if (wrap) wrap.hidden = !isAccountChange;
    if (current) {
      current.required = Boolean(isAccountChange);
      if (!isAccountChange) current.value = "";
    }
    if (byId("memberPasswordTitle")) {
      byId("memberPasswordTitle").textContent = isAccountChange ? "Change password" : "Choose a password";
    }
  }

  function showModal(panel = member ? "account" : "signin") {
    setPanel(panel);
    const backdrop = byId("memberAuthBackdrop");
    if (backdrop) backdrop.hidden = false;
    if (panel === "account") {
      window.dispatchEvent(new CustomEvent("member-profile-open"));
    }
    requestAnimationFrame(() => {
      const changingPassword = panel === "password" && !byId("memberCurrentPasswordWrap")?.hidden;
      const selector = panel === "signin"
        ? "#memberEmail"
        : panel === "password"
          ? changingPassword ? "#memberCurrentPassword" : "#memberNewPassword"
          : null;
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
    const initial = button.querySelector(".profileInitial");
    if (initial) initial.textContent = member ? initials(member.playerName) : "";
    button.classList.toggle("memberActive", Boolean(member));
    button.setAttribute("aria-label", member ? `Member account: ${member.playerName}` : "Member sign in");
    button.title = member ? `${member.playerName} · ${member.email}` : "Member sign in";
  }

  function initials(name) {
    return String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map(part => part[0]?.toUpperCase() || "")
      .join("") || "M";
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
    const name = byId("memberProfileName");
    const avatar = byId("memberProfileAvatar");
    if (label) label.textContent = member.email;
    if (name) name.textContent = member.playerName;
    if (avatar) avatar.textContent = initials(member.playerName);
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
    const currentPassword = String(byId("memberCurrentPassword")?.value || "");
    if (password.length < 8) return setStatus("Use at least 8 characters.", true);
    if (password !== confirmation) return setStatus("The passwords do not match.", true);
    const button = byId("memberPasswordBtn");
    if (button) button.disabled = true;
    setStatus("Saving password…");
    try {
      const attributes = currentPassword
        ? { password, current_password: currentPassword }
        : { password };
      const { error } = await client.auth.updateUser(attributes);
      if (error) throw error;
      await verifyMembership();
      if (byId("memberCurrentPassword")) byId("memberCurrentPassword").value = "";
      if (byId("memberNewPassword")) byId("memberNewPassword").value = "";
      if (byId("memberConfirmPassword")) byId("memberConfirmPassword").value = "";
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
    byId("memberChangePasswordBtn")?.addEventListener("click", () => {
      setPasswordMode(true);
      setPanel("password");
      requestAnimationFrame(() => byId("memberCurrentPassword")?.focus());
    });
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
          setTimeout(() => {
            setPasswordMode(false);
            showModal("password");
          }, 0);
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
          if (initialQueryMode === "recovery" || initialHashType === "invite" || initialHashType === "recovery") {
            setPasswordMode(false);
            showModal("password");
          }
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
