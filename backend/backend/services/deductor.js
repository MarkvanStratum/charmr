// services/deductor.js
module.exports = {
  call: ({ user, amount }) => {
    if (user.credits >= amount) {
      user.credits -= amount;
      console.log(`Deducted ${amount} credits from user. Remaining: ${user.credits}`);
      return true;
    } else {
      console.log("Not enough credits.");
      return false;
    }
  }
};
