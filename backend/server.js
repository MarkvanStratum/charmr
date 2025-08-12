<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Checkout</title>
<!-- Google tag (gtag.js) -->
<script async src="https://www.googletagmanager.com/gtag/js?id=G-FDQ6REQWS8"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  gtag('js', new Date());

  gtag('config', 'G-FDQ6REQWS8');
</script>
  <script src="https://js.stripe.com/v3/"></script>
  <style>
    body {
      font-family: Arial, sans-serif;
      background: #fdf2f8;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      align-items: center;
      padding: 40px 20px;
      min-height: 100vh;
      margin: 0;
    }

    #payment-form {
      background: white;
      padding: 25px 20px;
      border-radius: 12px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.1);
      width: 100%;
      max-width: 420px;
    }

    .plan {
      display: flex;
      align-items: center;
      margin-bottom: 15px;
    }

    .plan input[type="radio"] {
      margin-right: 10px;
    }

    label {
      display: block;
      margin-bottom: 6px;
      font-weight: bold;
    }

    input[type="text"] {
      width: 100%;
      padding: 10px;
      margin-bottom: 15px;
      border: 1px solid #ccc;
      border-radius: 6px;
      font-size: 16px;
    }

    #card-element {
      padding: 12px;
      border: 1px solid #ccc;
      border-radius: 6px;
      margin-bottom: 20px;
      background: #f9f9f9;
    }

    #submit {
      width: 100%;
      background-color: #ef476f;
      color: white;
      border: none;
      padding: 12px;
      border-radius: 6px;
      font-size: 16px;
      cursor: pointer;
    }

    #submit:hover {
      background-color: #d43d61;
    }

    #message {
      margin-top: 15px;
      font-size: 14px;
      color: red;
    }

    /* Style for link under form */
    .profiles-link {
      margin-top: 20px;
      text-align: center;
    }
    .profiles-link a {
      color: #ef476f;
      font-weight: bold;
      text-decoration: none;
    }
    .profiles-link a:hover {
      text-decoration: underline;
    }
  </style>

</head>
<body>
<script type="text/javascript" src="https://api.goaffpro.com/loader.js?shop=nzyvwvfbde"></script>
  <form id="payment-form">
    <div class="plan">
      <input type="radio" name="plan" value="price_1Rsdy1EJXIhiKzYGOtzvwhUH" id="plan5" checked>
      <label for="plan5">💌 10 Messages (avg. 2 hookups/month) – £0.16/day try Charmr at minumum cost!</label>
    </div>
    <div class="plan">
      <input type="radio" name="plan" value="price_1RsdzREJXIhiKzYG45b69nSl" id="plan20">
      <label for="plan20">🔥 50 Messages (avg. 15 hookups) – £0.66/day</label>
    </div>
    <div class="plan">
      <input type="radio" name="plan" value="price_1Rt6NcEJXIhiKzYGMsEZFd8f" id="plan99">
      <label for="plan99">💎 Unlimited (unlimited hookups) – £99</label>
    </div>

    <label for="cardholder-name">Name on card</label>
    <input type="text" id="cardholder-name" placeholder="Full name" required />

    <div id="card-element"><!-- Stripe injects card input here --></div>

    <button type="submit" id="submit">Pay</button>
    <div id="message"></div>
  </form>

  <!-- Link under the signup/payment box -->
  <div class="profiles-link">
    <a href="https://charmr.xyz/profiles.html">Take me to the girls profiles</a>
  </div>

  <script>
    const stripe = Stripe("pk_live_51Rhm4sEJXIhiKzYGIPVjXwZTzuKmqU7EOA6EpDIkrNTmtm4ooWHbDcSaBlyglSdJYhCyU4VgcI8Qo09Acc8upCUD00ekSRuN4q");
    const elements = stripe.elements();
    const card = elements.create("card");
    card.mount("#card-element");

    const form = document.getElementById("payment-form");
    const message = document.getElementById("message");

    // ---- helper to safely parse JSON or surface HTML errors ----
    async function safeJson(res) {
      const text = await res.text();
      let data = null;
      try { data = JSON.parse(text); } catch (_) { /* not JSON */ }
      return { ok: res.ok, status: res.status, data, text };
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      message.textContent = "";

      const selectedPlan = document.querySelector('input[name="plan"]:checked').value;
      const name = document.getElementById("cardholder-name").value;

      // NEW: require auth token so the server doesn’t return HTML login/redirect
      const token = localStorage.getItem("token");
      if (!token) {
        message.textContent = "Please sign in first. (No token found)";
        return;
      }

      try {
        // --- special flow for the £5 plan (32p auth -> 2-day trial -> £5 subscription)
        if (selectedPlan === "price_1Rsdy1EJXIhiKzYGOtzvwhUH") {
          // 1) Create 32p PaymentIntent
          const r1 = await fetch("https://charmr-jfmc.onrender.com/api/trial-intent", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            }
          });
          const j1 = await safeJson(r1);
          if (!j1.ok || !j1.data || !j1.data.clientSecret || !j1.data.paymentIntentId) {
            console.error("trial-intent response:", j1.status, j1.text);
            message.textContent = (j1.data && (j1.data.error || j1.data.message)) || "Could not start trial. Try again.";
            return;
          }

          // 2) Confirm the 32p PI (handles 3DS if needed)
          const { error, paymentIntent } = await stripe.confirmCardPayment(j1.data.clientSecret, {
            payment_method: {
              card: card,
              billing_details: { name }
            }
          });
          if (error) {
            message.textContent = error.message || "Card authentication failed.";
            return;
          }
          if (!paymentIntent || paymentIntent.status !== "succeeded") {
            message.textContent = "Card authentication did not complete.";
            return;
          }

          // 3) Start the £5 subscription with a 2-day trial
          const r2 = await fetch("https://charmr-jfmc.onrender.com/api/subscribe-trial", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${token}`
            },
            body: JSON.stringify({ paymentIntentId: j1.data.paymentIntentId })
          });
          const j2 = await safeJson(r2);
          if (!j2.ok) {
            console.error("subscribe-trial response:", j2.status, j2.text);
            message.textContent = (j2.data && (j2.data.error || j2.data.message)) || "Could not start subscription.";
            return;
          }

          // 4) Done
          window.location.href = `/thankyou.html?priceId=${selectedPlan}`;
          return;
        }

        // --- original flow for £20 and £99 (unchanged logic, but safe JSON)
        const res = await fetch("https://charmr-jfmc.onrender.com/api/create-payment-intent", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({ priceId: selectedPlan }),
        });

        const j = await safeJson(res);
        if (!j.ok || !j.data || !j.data.clientSecret) {
          console.error("create-payment-intent response:", j.status, j.text);
          message.textContent = (j.data && (j.data.error || j.data.message)) || "Payment failed to start. Try again.";
          return;
        }

        const result = await stripe.confirmCardPayment(j.data.clientSecret, {
          payment_method: {
            card: card,
            billing_details: { name },
          }
        });

        if (result.error) {
          message.textContent = result.error.message;
        } else if (result.paymentIntent.status === "succeeded") {
          window.location.href = `/thankyou.html?priceId=${selectedPlan}`;
        }
      } catch (err) {
        console.error(err);
        message.textContent = err.message || "Something went wrong. Try again.";
      }
    });
  </script>

  <!-- Currency symbol swap (US → $, Eurozone → €, otherwise keep £) -->
  <script>
    (function () {
      // ISO country codes for eurozone members (including Croatia since 2023)
      const EUROZONE = new Set([
        "AT","BE","HR","CY","EE","FI","FR","DE","GR","IE","IT",
        "LV","LT","LU","MT","NL","PT","SK","SI","ES"
      ]);

      function swapSymbol(symbol) {
        document.querySelectorAll('.plan label').forEach(label => {
          label.textContent = label.textContent.replace(/£/g, symbol);
        });
      }

      // Fetch the visitor's country code via IP and adjust symbols accordingly
      try {
        fetch("https://ipapi.co/country/")
          .then(r => r.ok ? r.text() : Promise.reject())
          .then(cc => {
            cc = (cc || "").trim().toUpperCase();
            if (cc === "US") {
              swapSymbol("$");
            } else if (EUROZONE.has(cc)) {
              swapSymbol("€");
            }
          })
          .catch(() => { /* leave GBP on failure */ });
      } catch (_) {
        /* leave GBP if anything unexpected happens */
      }
    })();
  </script>
</body>
</html>
