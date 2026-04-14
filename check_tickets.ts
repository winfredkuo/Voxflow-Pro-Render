
import { db } from './src/lib/firebase';
import { collection, getDocs, query, orderBy, limit } from 'firebase/firestore';

async function checkTickets() {
  try {
    const q = query(collection(db, "support_tickets"), orderBy("timestamp", "desc"), limit(1));
    const snap = await getDocs(q);
    if (snap.empty) {
      console.log("No tickets found.");
    } else {
      console.log("Latest Ticket:");
      console.log(JSON.stringify(snap.docs[0].data(), null, 2));
    }
  } catch (error) {
    console.error("Error fetching tickets:", error);
  }
  process.exit(0);
}

checkTickets();
