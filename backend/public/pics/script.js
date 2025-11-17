// Load and display all profiles on profiles.html
async function loadProfiles() {
  const container = document.getElementById('profiles-container');
  if (!container) return;

  try {
    const res = await fetch('girls.json');
    const girls = await res.json();

    girls.forEach(girl => {
      const card = document.createElement('div');
      card.className = 'profile-card';
      card.innerHTML = `
        <img src="${girl.photos[0]}" alt="${girl.name}" />
        <h2>${girl.name}, ${girl.age}</h2>
        <p>${girl.city}, ${girl.country}</p>
      `;
      card.addEventListener('click', () => {
        window.location.href = `profile.html?id=${girl.id}`;
      });
      container.appendChild(card);
    });
  } catch (err) {
    console.error('Error loading profiles:', err);
  }
}

// Load and display a single profile on profile.html
async function loadProfile() {
  const container = document.getElementById('profile-detail');
  if (!container) return;

  const params = new URLSearchParams(window.location.search);
  const id = parseInt(params.get('id'), 10);

  if (!id) {
    container.innerHTML = '<p>Profile not found.</p>';
    return;
  }

  try {
    const res = await fetch('girls.json');
    const girls = await res.json();

    const girl = girls.find(g => g.id === id);

    if (!girl) {
      container.innerHTML = '<p>Profile not found.</p>';
      return;
    }

    container.innerHTML = `
      <h2>${girl.name}, ${girl.age}</h2>
      <p>${girl.city}, ${girl.country}</p>
      <p>${girl.about}</p>
      <div class="photos-gallery">
        ${girl.photos.map(photo => `<img src="${photo}" alt="${girl.name} photo" />`).join('')}
      </div>
      <p><a href="profiles.html">Back to profiles</a></p>
    `;
  } catch (err) {
    console.error('Error loading profile:', err);
    container.innerHTML = '<p>Error loading profile data.</p>';
  }
}

// Run appropriate loader depending on page
document.addEventListener('DOMContentLoaded', () => {
  if (document.getElementById('profiles-container')) {
    loadProfiles();
  } else if (document.getElementById('profile-detail')) {
    loadProfile();
  }
});
<script>
function showNotification(name, message, avatar) {
  const notif = document.getElementById('message-notification');
  document.getElementById('notif-name').textContent = name;
  document.getElementById('notif-message').textContent = message;
  document.getElementById('notif-avatar').src = avatar;

  notif.classList.remove('hidden');

  // Slide down
  setTimeout(() => {
    notif.classList.add('show');
  }, 10);

  // Hide after 4 seconds
  setTimeout(() => {
    notif.classList.remove('show');
    setTimeout(() => notif.classList.add('hidden'), 400);
  }, 4000);
}

// TEST: Show notification after 5 seconds
setTimeout(() => {
  showNotification(
    "Sophie",
    "Hey, what are you up to? 😉",
    "https://randomuser.me/api/portraits/women/1.jpg"
  );
}, 5000);

}, 5000);
</script>

}

// Test trigger
// You can remove this later — it just lets you click anywhere to test the popup
document.body.addEventListener('click', () => {
  showNotification("Sophie", "Hey, what are you up to? 😉");
});

