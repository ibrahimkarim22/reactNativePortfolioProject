const genreColors = (genre) => {
  switch (genre) {
    case "Romance":
      return "#FF4081";
    case "Comedy":
      return "#FFD700";
    case "History":
      return "steelblue";
      case "Tragedy":
        return "#FF6347"
    default:
      return "transparent";
  }
};

export default genreColors;