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
    const response = await fetch("https://your-backend-url/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    if (response.ok) {
      alert("Registration successful! Please log in.");
      window.location.href = "login.html"; // redirect to login page
    } else {
      alert(data.error || "Registration failed.");
    }
  } catch (err) {
    console.error(err);
    alert("Error registering. Please try again later.");
  }
});
