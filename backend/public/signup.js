document.getElementById("signup-form").addEventListener("submit", async (e) => {
  e.preventDefault();

  const gender = document.getElementById("gender").value;
  const lookingFor = document.getElementById("lookingFor").value;
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();
  const phone = document.getElementById("phone").value.trim();

  const payload = { gender, lookingFor, email, password };
  if (phone) payload.phone = phone;

  try {
    const response = await fetch("https://charmr-jfmc.onrender.com/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (response.ok) {
      if (data.token) {
        localStorage.setItem("token", data.token); // ✅ Save the token
      }
      alert("Registration successful! Please log in.");
      window.location.href = "login.html";
    } else {
      alert(`Registration failed: ${data.error || JSON.stringify(data)}`);
      console.error("Registration error response:", data);
    }
  } catch (err) {
    console.error("Fetch error:", err);
    alert("Error registering. Please check the console for details.");
  }
});
