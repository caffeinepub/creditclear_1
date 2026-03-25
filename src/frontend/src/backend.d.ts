import type { Principal } from "@icp-sdk/core/principal";
export interface Some<T> {
    __kind__: "Some";
    value: T;
}
export interface None {
    __kind__: "None";
}
export type Option<T> = Some<T> | None;
export interface Client {
    id: bigint;
    status: string;
    createdAt: string;
    cityStateZip: string;
    fullName: string;
    ssnLast4: string;
    email: string;
    disputeCount: bigint;
    address: string;
    notes: string;
    phone: string;
    resolvedCount: bigint;
}
export interface Dispute {
    id: bigint;
    status: Status;
    clientId: bigint;
    clientName: string;
    date: string;
    account: string;
    bureau: string;
    daysLeft: bigint;
    reason: string;
}
export interface UserProfile {
    name: string;
}
export enum Status {
    resolved = "resolved",
    pending = "pending",
    investigating = "investigating",
    rejected = "rejected"
}
export enum UserRole {
    admin = "admin",
    user = "user",
    guest = "guest"
}
export interface backendInterface {
    addClient(clientInput: Client): Promise<bigint>;
    addDispute(disputeInput: Dispute): Promise<bigint>;
    assignCallerUserRole(user: Principal, role: UserRole): Promise<void>;
    deleteClient(id: bigint): Promise<void>;
    deleteDispute(id: bigint): Promise<void>;
    getAllClients(): Promise<Array<Client>>;
    getAllDisputes(): Promise<Array<Dispute>>;
    getApiKey(): Promise<string | null>;
    getCallerUserProfile(): Promise<UserProfile | null>;
    getCallerUserRole(): Promise<UserRole>;
    getUserProfile(user: Principal): Promise<UserProfile | null>;
    isCallerAdmin(): Promise<boolean>;
    saveCallerUserProfile(profile: UserProfile): Promise<void>;
    setApiKey(key: string): Promise<void>;
    updateClient(client: Client): Promise<void>;
    updateDisputeStatus(id: bigint, status: Status): Promise<void>;
}
