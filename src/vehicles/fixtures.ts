import type {Insured, Vehicle} from "./types.js";

export type CatalogRecord = Omit<Vehicle, "purchasePrice"> & {
    prices: { effectiveDate: string; amount: number }[];
};
export const vehicles: CatalogRecord[] = [
    {
        vehicleId: "ve-001",
        vin: "VIN123456789ABC",
        registrationNumber: "ZX123ABC",
        brand: "Tesla",
        model: "Model 3",
        vehicleType: "passenger_vehicle",
        modelYear: 2023,
        firstRegistrationDate: "2023-06-01",
        seats: 5,
        prices: [
            {effectiveDate: "2020-01-01", amount: 45000},
            {effectiveDate: "2024-01-01", amount: 42000},
            {effectiveDate: "2025-01-01", amount: 38000},
        ],
    },
    {
        vehicleId: "ve-002",
        vin: "VIN987654321XYZ",
        registrationNumber: "AB123456",
        brand: "Tesla",
        model: "Model Y",
        vehicleType: "suv",
        modelYear: 2024,
        firstRegistrationDate: "2024-03-01",
        seats: 5,
        prices: [
            {effectiveDate: "2020-01-01", amount: 52000},
            {effectiveDate: "2025-01-01", amount: 47000},
        ],
    },
    {
        vehicleId: "ve-003",
        vin: "VINBMW000000003",
        registrationNumber: "CD987654",
        brand: "BMW",
        model: "X3",
        vehicleType: "suv",
        modelYear: 2022,
        firstRegistrationDate: "2022-09-01",
        seats: 5,
        prices: [
            {effectiveDate: "2020-01-01", amount: 60000},
            {effectiveDate: "2025-01-01", amount: 49000},
        ],
    },
];
export const insured: Insured[] = [
    {
        id: "in-001",
        plateNumber: "ZH 638871",
        customerNumber: "C001",
        policyNumber: "P001",
        vehicleId: "ve-001",
    },
    {
        id: "in-002",
        plateNumber: "BE 12345",
        customerNumber: "C002",
        policyNumber: "P002",
        vehicleId: "ve-003",
    },
    {
        id: "in-003",
        plateNumber: "ZH 88888",
        customerNumber: "C001",
        policyNumber: "P003",
        vehicleId: "ve-002",
    },
    {
        id: "in-004",
        plateNumber: "TI 99999",
        customerNumber: "C003",
        policyNumber: "P004",
        vehicleId: "ve-missing",
    },
];
