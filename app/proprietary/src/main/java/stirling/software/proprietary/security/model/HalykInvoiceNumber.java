package stirling.software.proprietary.security.model;

import jakarta.persistence.*;

import lombok.Getter;

@Entity
@Table(name = "aziral_halyk_invoice_numbers")
@Getter
public class HalykInvoiceNumber {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
}
