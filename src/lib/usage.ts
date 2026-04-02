import { db } from './firebase';
import { collection, addDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from './firestore-errors';

export interface UsageLogData {
  uid: string;
  email: string;
  fileName: string;
  duration: number;
  version: 'V1' | 'V3';
  status: 'success' | 'error';
  error?: string;
}

export const logUsage = async (data: UsageLogData) => {
  try {
    const logData: any = {
      uid: data.uid,
      email: data.email,
      fileName: data.fileName,
      duration: data.duration,
      version: data.version,
      status: data.status,
      timestamp: new Date().toISOString()
    };
    if (data.error) logData.error = data.error;

    await addDoc(collection(db, 'usage_logs'), logData);
  } catch (error) {
    console.error('Failed to log usage:', error);
    // We don't throw here to avoid interrupting the main flow
    handleFirestoreError(error, OperationType.WRITE, 'usage_logs');
  }
};

export interface SupportTicketData {
  uid: string;
  email: string;
  subject: string;
  message: string;
  errorCode?: string;
}

export const submitSupportTicket = async (data: SupportTicketData) => {
  try {
    const ticketData: any = {
      uid: data.uid,
      email: data.email,
      subject: data.subject,
      message: data.message,
      timestamp: new Date().toISOString()
    };
    if (data.errorCode) ticketData.errorCode = data.errorCode;

    await addDoc(collection(db, 'support_tickets'), ticketData);
    return true;
  } catch (error) {
    console.error('Failed to submit support ticket:', error);
    handleFirestoreError(error, OperationType.WRITE, 'support_tickets');
    throw error;
  }
};
