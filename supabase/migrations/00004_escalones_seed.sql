INSERT INTO equivalencia_escalones (escalon, nivel_min_m, nivel_max_m) VALUES
  (1,  0.50, 0.70),
  (2,  0.70, 0.85),
  (3,  0.85, 1.00),
  (4,  1.00, 1.15),
  (5,  1.15, 1.30),
  (6,  1.30, 1.50),
  (7,  1.50, 1.70),
  (8,  1.70, 1.90),
  (9,  1.90, 2.10),
  (10, 2.10, 2.30)
ON CONFLICT DO NOTHING;
