/**
 * Synthetic sample documents for the demo seed (§10.2: realistic but synthetic).
 * Dates are chosen relative to a late-August 2026 "today" so the demo shows
 * overdue, imminent and far-future obligations at once.
 */
export interface SampleDoc {
  title: string;
  text: string;
}

export const SAMPLE_DOCS: SampleDoc[] = [
  {
    title: 'TechMart Invoice - MacBook Air',
    text: `TechMart Electronics Pvt Ltd
Tax Invoice
Invoice No: TM-2026-08112
Date of Purchase: 14 Aug 2026
Bill To: Demo User

Item: MacBook Air M3 13-inch
Qty: 1
Total Amount: Rs. 92,900.00
Order ID: 5539021188

Returns accepted within 10 days of delivery.
Manufacturer warranty of 24 months from date of purchase.
GSTIN: 07AABCU9603R1ZM`,
  },
  {
    title: 'HDFC ERGO Car Insurance Policy',
    text: `HDFC ERGO General Insurance
Private Car Package Policy
Policy No: 2312-3456-7890-1234
Insured Name: Demo User
Vehicle: Maruti Suzuki Baleno - MH12AB1234
Period of Insurance: From 05 Sep 2026 to 04 Sep 2027
Premium Amount: Rs. 18,540.00 (inclusive of GST)
IDV: Rs. 6,50,000`,
  },
  {
    title: 'StreamFlix Subscription Invoice',
    text: `StreamFlix India
Subscription Invoice
Merchant: StreamFlix
Plan: Premium Monthly Plan
Amount: Rs. 649.00
Renewal Date: 02 Sep 2026
Auto-debit mandate active on card ending 4589.`,
  },
  {
    title: 'BSES Electricity Bill - August',
    text: `BSES Rajdhani Power Limited
Electricity Bill - Domestic
Consumer No: 1234-5678-9012
Bill Date: 20 Aug 2026
Amount Due: Rs. 2,340.00
Due Date: 30 Aug 2026
Meter Reading: 45210 units`,
  },
  {
    title: 'IndiGo E-Ticket - Delhi to Dubai',
    text: `IndiGo Airlines - E-Ticket Itinerary
Passenger: Demo User
PNR: QWERTZ
Flight 6E-1234 DEL to DXB
Destination: Dubai
Departure: 15 Sep 2026 from Terminal 3
Return: 22 Sep 2026
Booking Reference: QWERTZ`,
  },
  {
    title: 'PUC Certificate - Baleno',
    text: `Authorised PUC Testing Centre
Pollution Under Control Certificate
Vehicle Registration No: MH12AB1234
Make Model: Maruti Suzuki Baleno
PUC Valid Till: 10 Oct 2026
Odometer: 24315 km
Fuel: Petrol`,
  },
];