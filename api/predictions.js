export default function handler(req, res) {
  res.status(200).json({
    predictions: [
      {
        prediction: "1 (62%)",
        gg: "GG (64%)",
        over25: "Over 2.5 (59%)",
        score: "2-1 (21%)"
      }
    ]
  });
}
