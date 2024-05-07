const genreColors = (genre) => {
  switch (genre) {
    case "Romance":
      return "deeppink";
    case "Comedy":
      return "green";
    case "History":
      return "steelblue";
    case "Tragedy":
      return "darkred";
    default:
      return "transparent";
  }
};

export default genreColors;
