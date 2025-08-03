document.getElementById("signup-form").addEventListener("submit", function (e) {
  e.preventDefault();
  
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value.trim();

  if (email && password) {
    alert("Signup successful! (In the real site, this will be sent to the backend)");
    // Redirect to login page later
    // window.location.href = "login.html";
  } else {
    alert("Please fill in all required fields.");
  }
});
