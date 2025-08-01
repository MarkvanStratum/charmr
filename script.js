document.getElementById("signup-form").addEventListener("submit", function (e) {
  e.preventDefault();
  
  // Simple validation (more can be added later)
  const email = document.getElementById("email").value;
  const password = document.getElementById("password").value;
  
  if (email && password) {
    alert("Signup successful! (In real site: now send data to backend)");
    // Redirect or store data
  } else {
    alert("Please fill in all required fields.");
  }
});
