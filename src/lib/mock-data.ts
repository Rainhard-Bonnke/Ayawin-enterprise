export type Category = "Beer" | "Spirits" | "Wine" | "Soft Drinks" | "Water" | "Juice";

export interface Product {
  id: string; sku: string; name: string; brand: string; category: Category;
  abv: number; packSize: string; litresPerUnit: number;
  costPrice: number; retailPrice: number; wholesalePrice: number; distributorPrice: number;
  stock: number; minStock: number; warehouse: string; expiry: string; barcode: string;
}

export const products: Product[] = [
  { id: "P001", sku: "TSK-500", name: "Tusker Lager 500ml", brand: "EABL", category: "Beer", abv: 4.2, packSize: "24x500ml", litresPerUnit: 0.5, costPrice: 180, retailPrice: 250, wholesalePrice: 220, distributorPrice: 200, stock: 1240, minStock: 200, warehouse: "Nairobi Main", expiry: "2026-08-15", barcode: "6161100012345" },
  { id: "P002", sku: "TSK-330", name: "Tusker Cider 330ml", brand: "EABL", category: "Beer", abv: 4.5, packSize: "24x330ml", litresPerUnit: 0.33, costPrice: 150, retailPrice: 220, wholesalePrice: 195, distributorPrice: 175, stock: 88, minStock: 150, warehouse: "Nairobi Main", expiry: "2026-07-10", barcode: "6161100012346" },
  { id: "P003", sku: "GNS-500", name: "Guinness Stout 500ml", brand: "EABL", category: "Beer", abv: 7.5, packSize: "24x500ml", litresPerUnit: 0.5, costPrice: 220, retailPrice: 320, wholesalePrice: 290, distributorPrice: 260, stock: 540, minStock: 100, warehouse: "Nairobi Main", expiry: "2026-09-20", barcode: "5000213000010" },
  { id: "P004", sku: "WCP-500", name: "Whitecap Lager 500ml", brand: "EABL", category: "Beer", abv: 4.5, packSize: "24x500ml", litresPerUnit: 0.5, costPrice: 175, retailPrice: 240, wholesalePrice: 215, distributorPrice: 195, stock: 920, minStock: 200, warehouse: "Nairobi Main", expiry: "2026-08-30", barcode: "6161100012347" },
  { id: "P005", sku: "BLZ-500", name: "Balozi Lager 500ml", brand: "Keroche", category: "Beer", abv: 5.0, packSize: "24x500ml", litresPerUnit: 0.5, costPrice: 160, retailPrice: 230, wholesalePrice: 205, distributorPrice: 185, stock: 670, minStock: 150, warehouse: "Mombasa Branch", expiry: "2026-10-05", barcode: "6161100012348" },
  { id: "P006", sku: "JW-RED", name: "Johnnie Walker Red 750ml", brand: "Diageo", category: "Spirits", abv: 40, packSize: "12x750ml", litresPerUnit: 0.75, costPrice: 1850, retailPrice: 2600, wholesalePrice: 2350, distributorPrice: 2150, stock: 320, minStock: 50, warehouse: "Nairobi Main", expiry: "2030-12-31", barcode: "5000267014206" },
  { id: "P007", sku: "JW-BLK", name: "Johnnie Walker Black 750ml", brand: "Diageo", category: "Spirits", abv: 40, packSize: "12x750ml", litresPerUnit: 0.75, costPrice: 3500, retailPrice: 4800, wholesalePrice: 4400, distributorPrice: 4100, stock: 145, minStock: 30, warehouse: "Nairobi Main", expiry: "2030-12-31", barcode: "5000267023748" },
  { id: "P008", sku: "SMV-750", name: "Smirnoff Vodka 750ml", brand: "Diageo", category: "Spirits", abv: 37.5, packSize: "12x750ml", litresPerUnit: 0.75, costPrice: 1200, retailPrice: 1750, wholesalePrice: 1580, distributorPrice: 1430, stock: 410, minStock: 60, warehouse: "Nairobi Main", expiry: "2030-12-31", barcode: "5410316430234" },
  { id: "P009", sku: "RCH-750", name: "Richot Brandy 750ml", brand: "Distell", category: "Spirits", abv: 43, packSize: "12x750ml", litresPerUnit: 0.75, costPrice: 950, retailPrice: 1400, wholesalePrice: 1260, distributorPrice: 1130, stock: 260, minStock: 50, warehouse: "Nairobi Main", expiry: "2030-12-31", barcode: "6001108055672" },
  { id: "P010", sku: "OLM-750", name: "Olmeca Tequila 750ml", brand: "Pernod Ricard", category: "Spirits", abv: 38, packSize: "12x750ml", litresPerUnit: 0.75, costPrice: 2200, retailPrice: 3100, wholesalePrice: 2820, distributorPrice: 2580, stock: 95, minStock: 40, warehouse: "Nairobi Main", expiry: "2030-12-31", barcode: "7501013005206" },
  { id: "P011", sku: "KCP-750", name: "Kingfisher Cape Wine 750ml", brand: "KWV", category: "Wine", abv: 12.5, packSize: "6x750ml", litresPerUnit: 0.75, costPrice: 850, retailPrice: 1250, wholesalePrice: 1120, distributorPrice: 1000, stock: 180, minStock: 30, warehouse: "Nairobi Main", expiry: "2027-06-30", barcode: "6001108100123" },
  { id: "P012", sku: "4TH-750", name: "Four Cousins Red 750ml", brand: "Van Loveren", category: "Wine", abv: 8, packSize: "6x750ml", litresPerUnit: 0.75, costPrice: 720, retailPrice: 1050, wholesalePrice: 940, distributorPrice: 840, stock: 240, minStock: 40, warehouse: "Nairobi Main", expiry: "2027-04-15", barcode: "6009880123451" },
  { id: "P013", sku: "KRS-300", name: "Krest Bitter Lemon 300ml", brand: "Coca-Cola", category: "Soft Drinks", abv: 0, packSize: "24x300ml", litresPerUnit: 0.3, costPrice: 35, retailPrice: 55, wholesalePrice: 48, distributorPrice: 42, stock: 2100, minStock: 300, warehouse: "Nairobi Main", expiry: "2026-03-20", barcode: "5449000131836" },
  { id: "P014", sku: "ALV-500", name: "Alvaro Pear 500ml", brand: "Coca-Cola", category: "Soft Drinks", abv: 0, packSize: "12x500ml", litresPerUnit: 0.5, costPrice: 60, retailPrice: 90, wholesalePrice: 80, distributorPrice: 72, stock: 880, minStock: 200, warehouse: "Nairobi Main", expiry: "2026-02-10", barcode: "5449000131837" },
  { id: "P015", sku: "COKE-500", name: "Coca-Cola 500ml", brand: "Coca-Cola", category: "Soft Drinks", abv: 0, packSize: "24x500ml", litresPerUnit: 0.5, costPrice: 40, retailPrice: 70, wholesalePrice: 60, distributorPrice: 52, stock: 3200, minStock: 500, warehouse: "Nairobi Main", expiry: "2026-05-12", barcode: "5449000000996" },
  { id: "P016", sku: "FNT-500", name: "Fanta Orange 500ml", brand: "Coca-Cola", category: "Soft Drinks", abv: 0, packSize: "24x500ml", litresPerUnit: 0.5, costPrice: 40, retailPrice: 70, wholesalePrice: 60, distributorPrice: 52, stock: 1850, minStock: 400, warehouse: "Kisumu Branch", expiry: "2026-04-22", barcode: "5449000050205" },
  { id: "P017", sku: "DSN-1L", name: "Dasani Water 1L", brand: "Coca-Cola", category: "Water", abv: 0, packSize: "12x1L", litresPerUnit: 1, costPrice: 45, retailPrice: 70, wholesalePrice: 60, distributorPrice: 52, stock: 1500, minStock: 250, warehouse: "Nairobi Main", expiry: "2027-01-15", barcode: "5449000054227" },
  { id: "P018", sku: "KMI-500", name: "Keringet Mineral 500ml", brand: "Keringet", category: "Water", abv: 0, packSize: "24x500ml", litresPerUnit: 0.5, costPrice: 25, retailPrice: 50, wholesalePrice: 42, distributorPrice: 35, stock: 2400, minStock: 400, warehouse: "Nairobi Main", expiry: "2027-03-01", barcode: "6161100099120" },
  { id: "P019", sku: "DEL-1L", name: "Delmonte Mango Juice 1L", brand: "Delmonte", category: "Juice", abv: 0, packSize: "12x1L", litresPerUnit: 1, costPrice: 180, retailPrice: 260, wholesalePrice: 230, distributorPrice: 210, stock: 410, minStock: 80, warehouse: "Nairobi Main", expiry: "2026-06-18", barcode: "0024000162018" },
  { id: "P020", sku: "PIC-1L", name: "Picana Pineapple 1L", brand: "Kevian", category: "Juice", abv: 0, packSize: "12x1L", litresPerUnit: 1, costPrice: 130, retailPrice: 200, wholesalePrice: 175, distributorPrice: 155, stock: 60, minStock: 100, warehouse: "Mombasa Branch", expiry: "2026-02-28", barcode: "6161100200012" },
];

export interface Customer {
  id: string; name: string; segment: "Bar/Restaurant" | "Wholesaler" | "Retailer" | "Distributor" | "Supermarket";
  kraPin: string; phone: string; email: string; location: string; creditLimit: number; balance: number; terms: string;
}
export const customers: Customer[] = [
  { id: "C001", name: "Brew Bistro Westlands", segment: "Bar/Restaurant", kraPin: "P051234567A", phone: "+254 712 345 001", email: "orders@brewbistro.co.ke", location: "Westlands, Nairobi", creditLimit: 500000, balance: 142500, terms: "Net 30" },
  { id: "C002", name: "Naivas Supermarket Karen", segment: "Supermarket", kraPin: "P051234568B", phone: "+254 712 345 002", email: "procurement@naivas.co.ke", location: "Karen, Nairobi", creditLimit: 2000000, balance: 890000, terms: "Net 45" },
  { id: "C003", name: "Quickmart Kilimani", segment: "Supermarket", kraPin: "P051234569C", phone: "+254 712 345 003", email: "buyer@quickmart.co.ke", location: "Kilimani, Nairobi", creditLimit: 1500000, balance: 0, terms: "Net 30" },
  { id: "C004", name: "Mama Oliech Wholesalers", segment: "Wholesaler", kraPin: "P051234570D", phone: "+254 712 345 004", email: "oliech@gmail.com", location: "Kisumu", creditLimit: 800000, balance: 320000, terms: "Net 15" },
  { id: "C005", name: "Sippers Lounge Kilimani", segment: "Bar/Restaurant", kraPin: "P051234571E", phone: "+254 712 345 005", email: "sippers@gmail.com", location: "Kilimani, Nairobi", creditLimit: 300000, balance: 285000, terms: "Net 30" },
  { id: "C006", name: "K1 Klub House", segment: "Bar/Restaurant", kraPin: "P051234572F", phone: "+254 712 345 006", email: "info@k1klub.co.ke", location: "Parklands, Nairobi", creditLimit: 600000, balance: 412000, terms: "Net 30" },
  { id: "C007", name: "Mombasa Liquor Distributors", segment: "Distributor", kraPin: "P051234573G", phone: "+254 712 345 007", email: "ops@mld.co.ke", location: "Mombasa", creditLimit: 3000000, balance: 1240000, terms: "Net 45" },
  { id: "C008", name: "Eldoret Wines & Spirits", segment: "Wholesaler", kraPin: "P051234574H", phone: "+254 712 345 008", email: "eldoretws@gmail.com", location: "Eldoret", creditLimit: 700000, balance: 0, terms: "Net 30" },
  { id: "C009", name: "Java House Yaya", segment: "Bar/Restaurant", kraPin: "P051234575I", phone: "+254 712 345 009", email: "supply@javahouse.com", location: "Yaya Centre, Nairobi", creditLimit: 400000, balance: 78000, terms: "Net 30" },
  { id: "C010", name: "Carrefour Two Rivers", segment: "Supermarket", kraPin: "P051234576J", phone: "+254 712 345 010", email: "kenya.buying@carrefour.com", location: "Two Rivers, Nairobi", creditLimit: 2500000, balance: 1580000, terms: "Net 60" },
];

export interface Supplier {
  id: string; name: string; kraPin: string; phone: string; email: string; terms: string; creditLimit: number; balance: number;
}
export const suppliers: Supplier[] = [
  { id: "S001", name: "East African Breweries Ltd (EABL)", kraPin: "P051000001A", phone: "+254 711 100 100", email: "trade@eabl.com", terms: "Net 30", creditLimit: 10000000, balance: 3400000 },
  { id: "S002", name: "Kenya Breweries Ltd (KBL)", kraPin: "P051000002B", phone: "+254 711 100 101", email: "supply@kbl.co.ke", terms: "Net 30", creditLimit: 8000000, balance: 1200000 },
  { id: "S003", name: "Keroche Breweries", kraPin: "P051000003C", phone: "+254 711 100 102", email: "sales@keroche.co.ke", terms: "Net 30", creditLimit: 5000000, balance: 850000 },
  { id: "S004", name: "Coca-Cola Beverages Africa", kraPin: "P051000004D", phone: "+254 711 100 103", email: "kenya@ccba.africa", terms: "Net 30", creditLimit: 6000000, balance: 2100000 },
  { id: "S005", name: "Diageo Kenya", kraPin: "P051000005E", phone: "+254 711 100 104", email: "trade.ke@diageo.com", terms: "Net 45", creditLimit: 7000000, balance: 0 },
];

export const warehouses = [
  { id: "W1", name: "Nairobi Main", location: "Industrial Area, Nairobi", manager: "James Mwangi" },
  { id: "W2", name: "Mombasa Branch", location: "Changamwe, Mombasa", manager: "Aisha Mohamed" },
  { id: "W3", name: "Kisumu Branch", location: "Kondele, Kisumu", manager: "Peter Otieno" },
];

export const users = [
  { id: "U1", name: "Admin User", email: "admin@company.local", role: "Admin", status: "Active", lastLogin: "2026-05-20T08:14:00" },
  { id: "U2", name: "Grace Wanjiku", email: "grace@company.local", role: "Manager", status: "Active", lastLogin: "2026-05-20T07:50:00" },
  { id: "U3", name: "Brian Otieno", email: "brian@company.local", role: "Sales Rep", status: "Active", lastLogin: "2026-05-19T18:22:00" },
  { id: "U4", name: "Faith Achieng", email: "faith@company.local", role: "Warehouse", status: "Active", lastLogin: "2026-05-20T06:30:00" },
  { id: "U5", name: "Daniel Kiprop", email: "daniel@company.local", role: "Accountant", status: "Active", lastLogin: "2026-05-19T17:45:00" },
  { id: "U6", name: "Samuel Njoroge", email: "samuel@company.local", role: "Driver", status: "Active", lastLogin: "2026-05-20T05:10:00" },
];

export interface SalesOrder {
  id: string; date: string; customer: string; rep: string; items: number; total: number;
  status: "Draft" | "Confirmed" | "Dispatched" | "Delivered" | "Invoiced";
}
export const salesOrders: SalesOrder[] = [
  { id: "SO-2026-0142", date: "2026-05-20", customer: "Brew Bistro Westlands", rep: "Brian Otieno", items: 8, total: 184500, status: "Confirmed" },
  { id: "SO-2026-0141", date: "2026-05-20", customer: "K1 Klub House", rep: "Brian Otieno", items: 12, total: 312000, status: "Dispatched" },
  { id: "SO-2026-0140", date: "2026-05-19", customer: "Naivas Supermarket Karen", rep: "Grace Wanjiku", items: 24, total: 890000, status: "Delivered" },
  { id: "SO-2026-0139", date: "2026-05-19", customer: "Mombasa Liquor Distributors", rep: "Brian Otieno", items: 56, total: 1420000, status: "Invoiced" },
  { id: "SO-2026-0138", date: "2026-05-18", customer: "Quickmart Kilimani", rep: "Grace Wanjiku", items: 18, total: 425000, status: "Invoiced" },
  { id: "SO-2026-0137", date: "2026-05-18", customer: "Sippers Lounge Kilimani", rep: "Brian Otieno", items: 6, total: 98500, status: "Draft" },
  { id: "SO-2026-0136", date: "2026-05-17", customer: "Java House Yaya", rep: "Grace Wanjiku", items: 10, total: 156000, status: "Delivered" },
  { id: "SO-2026-0135", date: "2026-05-17", customer: "Carrefour Two Rivers", rep: "Grace Wanjiku", items: 32, total: 1580000, status: "Invoiced" },
];

export interface Invoice {
  id: string; date: string; due: string; customer: string; kraPin: string; etr: string;
  subtotal: number; excise: number; vat: number; total: number;
  status: "Draft" | "Sent" | "Paid" | "Overdue" | "Cancelled";
}
export const invoices: Invoice[] = [
  { id: "INV-2026-0531", date: "2026-05-19", due: "2026-06-18", customer: "Mombasa Liquor Distributors", kraPin: "P051234573G", etr: "0010000123456789", subtotal: 980000, excise: 184500, vat: 186320, total: 1350820, status: "Sent" },
  { id: "INV-2026-0530", date: "2026-05-18", due: "2026-06-17", customer: "Quickmart Kilimani", kraPin: "P051234569C", etr: "0010000123456788", subtotal: 320000, excise: 52400, vat: 59584, total: 431984, status: "Paid" },
  { id: "INV-2026-0529", date: "2026-05-17", due: "2026-06-16", customer: "Carrefour Two Rivers", kraPin: "P051234576J", etr: "0010000123456787", subtotal: 1180000, excise: 218400, vat: 223744, total: 1622144, status: "Sent" },
  { id: "INV-2026-0528", date: "2026-04-12", due: "2026-05-12", customer: "Sippers Lounge Kilimani", kraPin: "P051234571E", etr: "0010000123456786", subtotal: 215000, excise: 38200, vat: 40512, total: 293712, status: "Overdue" },
  { id: "INV-2026-0527", date: "2026-04-08", due: "2026-05-08", customer: "K1 Klub House", kraPin: "P051234572F", etr: "0010000123456785", subtotal: 310000, excise: 56400, vat: 58624, total: 425024, status: "Overdue" },
  { id: "INV-2026-0526", date: "2026-05-15", due: "2026-06-14", customer: "Naivas Supermarket Karen", kraPin: "P051234568B", etr: "0010000123456784", subtotal: 660000, excise: 118200, vat: 124512, total: 902712, status: "Paid" },
];

export const purchaseOrders = [
  { id: "PO-2026-0089", date: "2026-05-19", supplier: "East African Breweries Ltd (EABL)", items: 18, total: 2840000, status: "Received" },
  { id: "PO-2026-0088", date: "2026-05-18", supplier: "Diageo Kenya", items: 6, total: 1980000, status: "Sent" },
  { id: "PO-2026-0087", date: "2026-05-17", supplier: "Coca-Cola Beverages Africa", items: 24, total: 1240000, status: "Received" },
  { id: "PO-2026-0086", date: "2026-05-15", supplier: "Keroche Breweries", items: 8, total: 720000, status: "Approved" },
  { id: "PO-2026-0085", date: "2026-05-14", supplier: "Kenya Breweries Ltd (KBL)", items: 14, total: 1820000, status: "Draft" },
];

export const deliveries = [
  { id: "DEL-2026-0312", order: "SO-2026-0141", customer: "K1 Klub House", driver: "Samuel Njoroge", vehicle: "KDH 432A", route: "Nairobi - Parklands", status: "In Transit", date: "2026-05-20" },
  { id: "DEL-2026-0311", order: "SO-2026-0140", customer: "Naivas Supermarket Karen", driver: "Samuel Njoroge", vehicle: "KDH 432A", route: "Nairobi - Karen", status: "Delivered", date: "2026-05-19" },
  { id: "DEL-2026-0310", order: "SO-2026-0139", customer: "Mombasa Liquor Distributors", driver: "John Mutua", vehicle: "KCT 911B", route: "Nairobi - Mombasa", status: "Delivered", date: "2026-05-19" },
  { id: "DEL-2026-0309", order: "SO-2026-0136", customer: "Java House Yaya", driver: "Samuel Njoroge", vehicle: "KDH 432A", route: "Nairobi - Yaya", status: "Delivered", date: "2026-05-17" },
  { id: "DEL-2026-0308", order: "SO-2026-0142", customer: "Brew Bistro Westlands", driver: "Samuel Njoroge", vehicle: "KDH 432A", route: "Nairobi - Westlands", status: "Pending", date: "2026-05-20" },
];

export const employees = [
  { id: "E001", name: "Admin User", department: "Executive", role: "CEO", salary: 450000, status: "Active" },
  { id: "E002", name: "Grace Wanjiku", department: "Sales", role: "Sales Manager", salary: 180000, status: "Active" },
  { id: "E003", name: "Brian Otieno", department: "Sales", role: "Senior Sales Rep", salary: 95000, status: "Active" },
  { id: "E004", name: "Faith Achieng", department: "Warehouse", role: "Warehouse Supervisor", salary: 78000, status: "Active" },
  { id: "E005", name: "Daniel Kiprop", department: "Finance", role: "Accountant", salary: 120000, status: "Active" },
  { id: "E006", name: "Samuel Njoroge", department: "Logistics", role: "Driver", salary: 45000, status: "Active" },
  { id: "E007", name: "John Mutua", department: "Logistics", role: "Driver", salary: 45000, status: "Active" },
  { id: "E008", name: "Mercy Wambui", department: "Sales", role: "Sales Rep", salary: 65000, status: "On Leave" },
];

export const monthlyRevenue = [
  { month: "Nov", revenue: 8200000 },
  { month: "Dec", revenue: 11400000 },
  { month: "Jan", revenue: 9800000 },
  { month: "Feb", revenue: 9100000 },
  { month: "Mar", revenue: 10600000 },
  { month: "Apr", revenue: 12300000 },
  { month: "May", revenue: 13800000 },
];

export const topProducts = [
  { name: "Tusker 500ml", units: 4820 },
  { name: "Coca-Cola 500ml", units: 4210 },
  { name: "Whitecap 500ml", units: 3640 },
  { name: "Guinness 500ml", units: 2180 },
  { name: "Smirnoff 750ml", units: 1720 },
  { name: "Krest 300ml", units: 1580 },
  { name: "JW Red 750ml", units: 1240 },
  { name: "Balozi 500ml", units: 1180 },
  { name: "Fanta 500ml", units: 1090 },
  { name: "Alvaro 500ml", units: 920 },
];

export const salesByCategory = [
  { name: "Beer", value: 6800000 },
  { name: "Spirits", value: 3200000 },
  { name: "Wine", value: 980000 },
  { name: "Soft Drinks", value: 2100000 },
  { name: "Water", value: 420000 },
  { name: "Juice", value: 300000 },
];

export const alerts = [
  { type: "stock", severity: "high", message: "Tusker Cider 330ml below minimum (88 / 150)" },
  { type: "stock", severity: "high", message: "Picana Pineapple 1L below minimum (60 / 100)" },
  { type: "invoice", severity: "high", message: "INV-2026-0528 overdue by 8 days — Sippers Lounge" },
  { type: "invoice", severity: "high", message: "INV-2026-0527 overdue by 12 days — K1 Klub House" },
  { type: "expiry", severity: "medium", message: "Picana Pineapple 1L expires in 18 days" },
  { type: "expiry", severity: "medium", message: "Alvaro Pear 500ml expires in 32 days" },
];
