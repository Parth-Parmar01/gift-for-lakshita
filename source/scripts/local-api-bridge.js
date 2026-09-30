(function () {
  const remoteApi = "https://ourmoments.live/wp-json/om/v1";
  const apiBase = "/api";
  const originalFetch = window.fetch.bind(window);

  function encodeViewData(data) {
    const bytes = new TextEncoder().encode(JSON.stringify(data));
    let binary = "";
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function decodeDraft() {
    const match = window.location.hash.match(/(?:[?&]d=|#draft=)([^&]+)/);
    if (!match) throw new Error("The birthday draft could not be read.");
    const encoded = match[1].replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(encoded + "=".repeat((4 - encoded.length % 4) % 4));
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  }

  function createDirectLink(button) {
    button.disabled = true;
    return Promise.resolve().then(() => {
      const form = new FormData();
      const draft = decodeDraft();
      const dateLock = document.querySelector("#om-bday-date-lock-input");
      if (dateLock && !dateLock.checked) delete draft.b;
      Object.entries(draft).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
          form.append(key, typeof value === "object" ? JSON.stringify(value) : String(value));
        }
      });
      return originalFetch(`${apiBase}/create`, { method: "POST", body: form });
    })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "The link could not be created.");
        showGeneratedLink(payload);
      })
      .catch((error) => showLinkError(error.message))
      .finally(() => { button.disabled = false; });
  }

  function loadSavedSurprise() {
    const match = window.location.pathname.match(/^\/s\/([^/]+)$/);
    if (!match || new URLSearchParams(window.location.search).has("d")) return;

    originalFetch(`${apiBase}/s/${encodeURIComponent(match[1])}`)
      .then((response) => {
        if (!response.ok) throw new Error("Saved surprise was not found.");
        return response.json();
      })
      .then((payload) => {
        const saved = payload.data || payload.surprise;
        const data = saved && typeof saved === "object"
          ? {
              ...saved,
              n: saved.n || saved.name || "",
              f: saved.f || saved.from || "",
              rs: saved.rs || saved.reasons || ["", "", "", "", ""],
              m: saved.m || saved.letter || "",
              ck: saved.ck || saved.cake || "c",
            }
          : saved;
        if (!data || typeof data !== "object") throw new Error("Saved surprise data is invalid.");
        window.location.replace(`${window.location.pathname}?d=${encodeViewData(data)}`);
      })
      .catch(() => {});
  }

  loadSavedSurprise();

  document.addEventListener("click", (event) => {
    const button = event.target.closest("#om-bday-pay-btn");
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    createDirectLink(button);
  }, true);

  function showGeneratedLink(payload) {
    const result = payload && payload.data && typeof payload.data === "object"
      ? { ...payload.data, ...payload }
      : payload || {};
    const code = result.code || result.shortCode;
    const link = result.link || result.url ||
      (code && `${window.location.origin}/s/${code}`);
    if (!link || document.querySelector("#local-link-modal")) return;
    if (!code) return;

    const modal = document.createElement("div");
    modal.id = "local-link-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);padding:20px";
    const escapedLink = link.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
    modal.innerHTML = `
      <div style="box-sizing:border-box;max-width:480px;width:100%;background:#fff;border-radius:20px;padding:28px;text-align:center;font-family:Arial,sans-serif;box-shadow:0 20px 60px #0006">
        <h2 style="margin:0 0 10px;color:#222">Your private link is ready 🎉</h2>
        <p style="margin:0 0 8px;color:#555">Enter the OTP to unlock and copy your link.</p>
        <div style="padding:14px;border-radius:12px;background:#f7f7f7;color:#777;filter:blur(7px);user-select:none;pointer-events:none;overflow:hidden;white-space:nowrap">${escapedLink}</div>
        <p style="margin:16px 0 6px;color:#555;font-size:13px">Enter the 6-digit OTP sent to your webhook.</p>
        <input id="local-link-otp" inputmode="numeric" maxlength="6" placeholder="Enter 6-digit OTP" style="box-sizing:border-box;width:100%;padding:12px;border:2px solid #ddd;border-radius:10px;font-size:16px;text-align:center;letter-spacing:4px">
        <p id="local-link-otp-message" style="min-height:18px;margin:8px 0 0;color:#d21d54;font-size:13px"></p>
        <div id="local-link-revealed" hidden>
          <input id="local-link-value" readonly value="${escapedLink}" style="box-sizing:border-box;width:100%;padding:12px;border:2px solid #ec1c64;border-radius:10px;font-size:14px">
          <button type="button" data-copy style="margin-top:16px;padding:12px 24px;border:0;border-radius:10px;background:#ec1c64;color:#fff;font-size:16px;cursor:pointer">Copy link</button>
        </div>
        <button type="button" data-unlock style="margin-top:12px;padding:12px 24px;border:0;border-radius:10px;background:#ec1c64;color:#fff;font-size:16px;cursor:pointer">Unlock link</button>
        <button type="button" data-close style="margin-left:8px;padding:12px 24px;border:0;border-radius:10px;background:#eee;color:#333;font-size:16px;cursor:pointer">Close</button>
      </div>`;
    const otpInput = modal.querySelector("#local-link-otp");
    const unlockButton = modal.querySelector("[data-unlock]");
    const otpMessage = modal.querySelector("#local-link-otp-message");
    unlockButton.addEventListener("click", async () => {
      unlockButton.disabled = true;
      otpMessage.textContent = "Checking OTP...";
      try {
        const response = await originalFetch(`${apiBase}/unlock`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ code, otp: otpInput.value.trim() }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "The OTP could not be verified.");
        otpMessage.textContent = "Link unlocked.";
        otpInput.hidden = true;
        unlockButton.hidden = true;
        modal.querySelector("#local-link-revealed").hidden = false;
      } catch (error) {
        otpMessage.textContent = error.message;
        unlockButton.disabled = false;
      }
    });
    modal.querySelector("[data-copy]").addEventListener("click", () => navigator.clipboard.writeText(link));
    modal.querySelector("[data-close]").addEventListener("click", () => modal.remove());
    document.body.appendChild(modal);
  }

  function showLinkError(message) {
    const existing = document.querySelector("#local-link-error-modal");
    if (existing) existing.remove();
    const modal = document.createElement("div");
    modal.id = "local-link-error-modal";
    modal.style.cssText = "position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.65);padding:20px";
    modal.innerHTML = `<div style="box-sizing:border-box;max-width:420px;width:100%;background:#fff;border-radius:20px;padding:28px;text-align:center;font-family:Arial,sans-serif;box-shadow:0 20px 60px #0006"><h2 style="margin:0 0 10px;color:#222">The link was not created</h2><p style="margin:0 0 16px;color:#555">${String(message).replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\\"": "&quot;" })[character])}</p><button type="button" style="padding:12px 24px;border:0;border-radius:10px;background:#ec1c64;color:#fff;font-size:16px;cursor:pointer">Close</button></div>`;
    modal.querySelector("button").addEventListener("click", () => modal.remove());
    document.body.appendChild(modal);
  }

  window.Razorpay = function (options) {
    this.open = function () {
      if (typeof options.handler === "function") {
        options.handler({ razorpay_payment_id: "direct-link-flow" });
      }
    };
  };
  window.Razorpay.isLocalDirectLinkFlow = true;

  const paymentTextObserver = new MutationObserver(() => {
    document.querySelectorAll("body *").forEach((element) => {
      if (element.children.length === 0 && /payment|reload|gateway/i.test(element.textContent || "")) {
        element.textContent = "Create your private link.";
      }
    });
  });
  paymentTextObserver.observe(document.documentElement, { childList: true, subtree: true });

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, inputUrl, ...rest) {
    const requestUrl = String(inputUrl);
    if (requestUrl.startsWith(remoteApi)) {
      inputUrl = apiBase + requestUrl.slice(remoteApi.length);
    }
    this._localApiPath = new URL(inputUrl, window.location.origin).pathname;
    return originalOpen.call(this, method, inputUrl, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (this._localApiPath === "/api/create") {
      const request = {};
      this.addEventListener("load", () => {
        if (this.status >= 200 && this.status < 300) {
          try { showGeneratedLink(JSON.parse(this.responseText)); } catch { /* Existing UI handles malformed responses. */ }
        } else {
          try { showLinkError(JSON.parse(this.responseText).error || "The link could not be created."); } catch { showLinkError("The link could not be created."); }
        }
      }, { once: true });
      originalSend.call(this, body);
      return;
    }
    return originalSend.call(this, body);
  };

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : input.url;
    const parsedUrl = new URL(url, window.location.origin);
    if (!url.startsWith(remoteApi) && parsedUrl.pathname !== "/api/create") {
      return originalFetch(input, init);
    }

    const localUrl = url.startsWith(remoteApi)
      ? apiBase + url.slice(remoteApi.length)
      : parsedUrl.pathname + parsedUrl.search;
    const localPath = new URL(localUrl, window.location.origin).pathname;
    if (
      localPath === "/api/create-order" ||
      localPath === "/api/order-status" ||
      localPath === "/api/cf-verify"
    ) {
      return Promise.resolve(new Response(JSON.stringify({
        status: "success",
        order_id: "direct-link-flow",
        payment_status: "SUCCESS",
        verified: true,
        amount: 0,
        currency: "INR",
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    }
    if (localPath === "/api/create") {
      const request = { ...(init || {}) };
      if (!init && input instanceof Request) {
        request.method = input.method;
        request.headers = input.headers;
        if (input.method !== "GET" && input.method !== "HEAD") {
          return input.clone().formData().then((body) => {
            request.body = body;
            return originalFetch(localUrl, request);
          }).then((response) => {
            if (!response.ok) throw new Error("The link could not be created.");
            return response.clone().json().then((payload) => {
              showGeneratedLink(payload);
              return response;
            });
          }).catch((error) => {
            alert(error.message);
            throw error;
          });
        }
      }
      return originalFetch(localUrl, request)
        .then((response) => {
          if (!response.ok) {
            return response.clone().json().then((error) => {
              throw new Error(error.error || "The link could not be created.");
            });
          }
          return response.clone().json().then((payload) => {
            showGeneratedLink(payload);
            return response;
          });
        })
        .catch((error) => {
          alert(error.message);
          throw error;
        });
    }
    return originalFetch(localUrl, init);
  };
})();
