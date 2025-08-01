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
