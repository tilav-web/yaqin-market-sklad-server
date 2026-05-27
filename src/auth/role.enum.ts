/**
 * Application-wide role hierarchy.
 *
 * - CUSTOMER  — default for every user (they can always order)
 * - SELLER    — granted after admin approves their SellerApplication
 * - STAFF     — granted via QR invitation into a specific shop
 * - ADMIN     — promoted by another admin (or seeded)
 *
 * A single user can hold multiple roles (e.g. seller and staff at a friend's shop).
 * Use {@link RolesGuard} with the {@link Roles} decorator to gate routes.
 */
export enum Role {
  Customer = 'customer',
  Seller = 'seller',
  Staff = 'staff',
  Admin = 'admin',
}
