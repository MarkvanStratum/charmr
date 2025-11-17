const girls = [
  {
    id: 1,
    name: "Amelia White",
    age: 26,
    city: "London",
    image: "https://randomuser.me/api/portraits/women/1.jpg"
  },
  {
    id: 2,
    name: "Olivia Smith",
    age: 24,
    city: "Manchester",
    image: "https://randomuser.me/api/portraits/women/2.jpg"
  },
  {
    id: 3,
    name: "Sophia Taylor",
    age: 29,
    city: "Birmingham",
    image: "https://randomuser.me/api/portraits/women/3.jpg"
  }
  // ... up to 300
];

const container = document.getElementById("profileContainer");

girls.forEach(girl => {
  const card = document.createElement("div");
  card.className = "profile-card";
  card.innerHTML = `
    <img src="${girl.image}" alt="${girl.name}">
    <h3>${girl.name}</h3>
    <p>Age: ${girl.age}</p>
    <p>City: ${girl.city}</p>
    <div class="btn-group">
      <button onclick="window.location.href='profile.html?id=${girl.id}'">View Profile</button>
      <button onclick="window.location.href='chat.html?id=${girl.id}'">Chat</button>
    </div>
  `;
  container.appendChild(card);
});
