document.getElementById("login-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  try {
    const res = await fetch("https://charmr-jfmc.onrender.com/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });

    const data = await res.json();

    if (res.ok && data.token) {
      localStorage.setItem("authToken", data.token);
      alert("Login successful!");
      window.location.href = "profiles.html"; // redirect to profiles page
    } else {
      alert(data.error || "Login failed. Please check your email and password.");
      console.error("Login error:", data);
    }
  } catch (err) {
    console.error("Network or server error:", err);
    alert("Error logging in. Please try again later.");
  }
});
