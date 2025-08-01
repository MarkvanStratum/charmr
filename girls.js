fetch('girls.json')
  .then(response => response.json())
  .then(girls => {
    const container = document.getElementById('profile-container');

    girls.forEach(girl => {
      const card = document.createElement('div');
      card.className = 'profile-card';
      card.innerHTML = `
        <img src="${girl.image || 'https://via.placeholder.com/150'}" alt="${girl.name}" />
        <h3>${girl.name}, ${girl.age}</h3>
        <p>${girl.city}</p>
        <a href="chat.html?girlId=${girl.id}">Chat with ${girl.name}</a>
      `;
      container.appendChild(card);
    });
  })
  .catch(error => {
    console.error('Error loading girls.json:', error);
  });
