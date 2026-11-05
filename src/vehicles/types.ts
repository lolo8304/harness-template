import type {errorBody} from "../common/errors.js";

export interface PurchasePrice {
    amount: number;
    currency: "CHF";
    asOfDate: string;
}

export interface Vehicle {
    vehicleId: string;
    vin: string;
    registrationNumber: string;
    brand: string;
    model: string;
    vehicleType: string;
    modelYear: number;
    firstRegistrationDate: string;
    seats: number;
    purchasePrice: PurchasePrice;
}

export interface Insured {
    id: string;
    plateNumber: string;
    customerNumber: string;
    policyNumber: string;
    vehicleId: string;
}

export interface Joined {
    insured: Insured;
    vehicle?: Vehicle;
    vehicleLookupError?: ReturnType<typeof errorBody>["error"];
}

export type Kind = "vehicles" | "insured" | "combined";
export type Search = Record<string, string | number> & {
    page: number;
    limit: number;
    mode?: string;
    asOfDate?: string;
};
