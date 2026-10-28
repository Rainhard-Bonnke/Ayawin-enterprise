-- Catalog-only expansion: 52 Kenya-market beverage families x 24 package variants = 1,248 SKUs.
-- This migration intentionally creates no stock, sales, invoices, purchases, payments, or ledger movements.

WITH drink_families(code, brand, product, category, base_cost, reorder_point) AS (
  VALUES
    ('TUSKER', 'Tusker', 'Lager', 'BEER', 175, 120),
    ('TUSMALT', 'Tusker', 'Malt Lager', 'BEER', 180, 100),
    ('TUSCIDER', 'Tusker', 'Cider', 'CIDER', 210, 80),
    ('PIL', 'Pilsner', 'Lager', 'BEER', 165, 120),
    ('WHITECAP', 'White Cap', 'Lager', 'BEER', 175, 120),
    ('BAL', 'Balozi', 'Lager', 'BEER', 155, 100),
    ('ALLSOPP', 'Allsopp', 'Lager', 'BEER', 170, 80),
    ('GUINNESS', 'Guinness', 'Stout', 'BEER', 220, 100),
    ('GUINZERO', 'Guinness', 'Zero Alcohol Stout', 'MALT', 210, 70),
    ('HEINEKEN', 'Heineken', 'Lager', 'BEER', 235, 80),
    ('BUDWEISER', 'Budweiser', 'Lager', 'BEER', 220, 80),
    ('SAVANNA', 'Savanna', 'Dry Cider', 'CIDER', 260, 70),
    ('SOMERSBY', 'Somersby', 'Apple Cider', 'CIDER', 145, 100),
    ('KIBAOCIDER', 'Kibao', 'Cider', 'CIDER', 160, 70),
    ('FOURCOUSINS', 'Four Cousins', 'Sweet Red Wine', 'WINE', 520, 50),
    ('KWV', 'KWV', 'Classic Red Wine', 'WINE', 650, 50),
    ('CELLAR', 'Cellar Cask', 'Red Wine', 'WINE', 580, 40),
    ('ROBERTSON', 'Robertson', 'Chenin Blanc', 'WINE', 720, 40),
    ('DROSTDY', 'Drostdy-Hof', 'White Wine', 'WINE', 600, 40),
    ('PROSECCO', 'Prosecco', 'Sparkling Wine', 'SPARKLING', 1200, 25),
    ('JACOBS', 'Jacobs Creek', 'Sparkling Wine', 'SPARKLING', 1450, 25),
    ('JWRED', 'Johnnie Walker', 'Red Label Whisky', 'SPIRITS', 1850, 30),
    ('JWBLACK', 'Johnnie Walker', 'Black Label Whisky', 'SPIRITS', 3200, 25),
    ('JAMESON', 'Jameson', 'Irish Whiskey', 'SPIRITS', 2850, 25),
    ('BALLANTINE', 'Ballantines', 'Finest Whisky', 'SPIRITS', 2200, 25),
    ('FAMOUS', 'The Famous Grouse', 'Blended Scotch Whisky', 'SPIRITS', 2400, 20),
    ('HENNESSY', 'Hennessy', 'VS Cognac', 'SPIRITS', 5200, 15),
    ('SMIRNOFF', 'Smirnoff', 'Vodka', 'SPIRITS', 1350, 40),
    ('ABSOLUT', 'Absolut', 'Vodka', 'SPIRITS', 2100, 25),
    ('GORDONS', 'Gordon''s', 'London Dry Gin', 'SPIRITS', 1550, 35),
    ('BEEFEATER', 'Beefeater', 'London Dry Gin', 'SPIRITS', 2300, 20),
    ('KENYACANE', 'Kenya Cane', 'Vodka', 'SPIRITS', 850, 40),
    ('CHROME', 'Chrome', 'Vodka', 'SPIRITS', 720, 50),
    ('KIBAOSPIRIT', 'Kibao', 'Cane Spirit', 'SPIRITS', 780, 40),
    ('CAPTAIN', 'Captain Morgan', 'Spiced Gold Rum', 'SPIRITS', 1900, 25),
    ('BACARDI', 'Bacardi', 'White Rum', 'SPIRITS', 2100, 25),
    ('BAILEYS', 'Baileys', 'Irish Cream', 'SPIRITS', 2600, 20),
    ('BACARDIBREEZER', 'Bacardi Breezer', 'Fruit Cooler', 'RTD', 170, 100),
    ('SMIRNOFFICE', 'Smirnoff Ice', 'Vodka Cooler', 'RTD', 180, 100),
    ('HUNTERS', 'Hunters', 'Dry Cider', 'RTD', 190, 90),
    ('COKE', 'Coca-Cola', 'Cola', 'SOFT', 40, 300),
    ('FANTA', 'Fanta', 'Orange', 'SOFT', 40, 300),
    ('SPRITE', 'Sprite', 'Lemon Lime', 'SOFT', 40, 300),
    ('STONEY', 'Stoney', 'Ginger Ale', 'SOFT', 42, 250),
    ('PEPSI', 'Pepsi', 'Cola', 'SOFT', 40, 250),
    ('MIRINDA', 'Mirinda', 'Orange', 'SOFT', 38, 250),
    ('KREST', 'Krest', 'Bitter Lemon', 'MIXERS', 45, 180),
    ('TONIC', 'Schweppes', 'Tonic Water', 'MIXERS', 65, 150),
    ('GINGERALE', 'Schweppes', 'Ginger Ale', 'MIXERS', 65, 150),
    ('DASANI', 'Dasani', 'Mineral Water', 'WATER', 35, 400),
    ('AQUAMIST', 'Aquamist', 'Mineral Water', 'WATER', 22, 500),
    ('KERINGET', 'Keringet', 'Natural Water', 'WATER', 45, 350),
    ('ALOEUP', 'Aloe Up', 'Flavoured Water', 'WATER', 55, 180),
    ('DELMONTE', 'Del Monte', 'Fruit Juice', 'JUICE', 150, 150),
    ('AFIA', 'Afia', 'Fruit Juice', 'JUICE', 130, 150),
    ('CAPPY', 'Cappy', 'Fruit Juice', 'JUICE', 120, 120),
    ('MANGUO', 'Manguo', 'Mango Juice', 'JUICE', 140, 120),
    ('RED BULL', 'Red Bull', 'Energy Drink', 'ENERGY', 130, 120),
    ('MONSTER', 'Monster', 'Energy Drink', 'ENERGY', 180, 100),
    ('BURN', 'Burn', 'Energy Drink', 'ENERGY', 95, 120),
    ('AFRICAN', 'African Originals', 'Energy Drink', 'ENERGY', 80, 100),
    ('POWERADE', 'Powerade', 'Sports Drink', 'SPORTS', 110, 100),
    ('LUCOZADE', 'Lucozade', 'Sports Drink', 'SPORTS', 120, 80),
    ('MALA', 'Mala', 'Fermented Milk', 'MALT', 55, 120),
    ('YOGHURT', 'Brookside', 'Drinking Yoghurt', 'MALT', 75, 120),
    ('MALTGUINNESS', 'Guinness', 'Malt Drink', 'MALT', 95, 100),
    ('OATS', 'Brookside', 'Oat Drink', 'MALT', 120, 80)
), packages(code, label, multiplier) AS (
  VALUES
    ('200-TETRA', '200ml Tetra', 0.55),
    ('250-CAN', '250ml Can', 0.7),
    ('250-PET', '250ml PET', 0.65),
    ('275-GLASS', '275ml Glass', 0.72),
    ('300-GLASS', '300ml Glass', 0.78),
    ('300-PET', '300ml PET', 0.75),
    ('300-TETRA', '300ml Tetra', 0.75),
    ('330-CAN', '330ml Can', 0.9),
    ('330-GLASS', '330ml Glass', 0.92),
    ('350-CAN', '350ml Can', 0.95),
    ('400-PET', '400ml PET', 1.0),
    ('500-CAN', '500ml Can', 1.25),
    ('500-GLASS', '500ml Glass', 1.2),
    ('500-PET', '500ml PET', 1.15),
    ('600-PET', '600ml PET', 1.3),
    ('650-GLASS', '650ml Glass', 1.35),
    ('750-GLASS', '750ml Glass', 1.65),
    ('750-PET', '750ml PET', 1.55),
    ('1L-GLASS', '1L Glass', 2.0),
    ('1L-PET', '1L PET', 1.9),
    ('1L-TETRA', '1L Tetra', 1.85),
    ('1.25L-PET', '1.25L PET', 2.2),
    ('1.5L-PET', '1.5L PET', 2.55),
    ('2L-PET', '2L PET', 3.1)
)
INSERT INTO erp_items (
  company_id, category_id, tax_group_id, uom_id, item_code, name,
  description, cost_method, standard_cost, reorder_point,
  is_purchasable, is_saleable, is_stock_item, is_active
)
SELECT c.id,
       cat.id,
       tg.id,
       uom.id,
       'KE-' || df.code || '-' || replace(p.code, '.', ''),
       df.brand || ' ' || df.product || ' ' || p.label,
       'Kenya beverage catalog test SKU; catalog-only seed with no opening stock or transactions.',
       'weighted_average',
       round((df.base_cost * p.multiplier)::numeric, 2),
       greatest(10, round(df.reorder_point * p.multiplier)),
       TRUE, TRUE, TRUE, TRUE
FROM erp_companies c
CROSS JOIN drink_families df
CROSS JOIN packages p
JOIN erp_item_categories cat ON cat.company_id = c.id AND cat.code = df.category
JOIN erp_tax_groups tg ON tg.company_id = c.id AND tg.code = 'STD-VAT'
JOIN erp_uom uom ON uom.company_id = c.id AND uom.code = 'EA'
WHERE c.code = 'MARTIN'
  AND NOT EXISTS (
    SELECT 1 FROM erp_items existing
    WHERE existing.company_id = c.id
      AND existing.item_code = 'KE-' || df.code || '-' || replace(p.code, '.', '')
  );
