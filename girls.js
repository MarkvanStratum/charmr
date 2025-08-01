fetch('girls.json')
  .then(response => response.json())
  .then(data => {
    const container = document.getElementById('profiles-container');
    container.innerHTML = ''; // Clear loading message

    data.forEach(girl => {
      const card = document.createElement('div');
      card.className = 'profile-card';

      card.innerHTML = `
        <h2>${girl.name}, ${girl.age}</h2>
        <p><strong>${girl.city}</strong></p>
        <img src="${girl.image || 'placeholder.jpg'}" alt="${girl.name}" />
        <p>${girl.description}</p>
        <a href="#">Chat with ${girl.name}</a>
      `;

      container.appendChild(card);
    });
  })
  .catch(error => {
    document.getElementById('profiles-container').innerText = 'Failed to load profiles.';
    console.error('Error loading profiles:', error);
  });
