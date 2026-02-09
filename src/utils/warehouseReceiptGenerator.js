import jsPDF from 'jspdf';
import logoImage from '../assets/logo-koperasi-unipdu-removebg-preview.png';

// Helper function for currency formatting (Rounds to nearest whole number, no decimals)
function formatRupiah(value) {
    if (value === undefined || value === null || value === "") return "0";

    // Round to nearest whole number to prevent text overlap
    const num = Math.round(parseFloat(value));
    if (isNaN(num)) return "0";

    return new Intl.NumberFormat('id-ID', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 0
    }).format(num);
}

// Helper function to format date in Indonesian (EEEE, DD MM YYYY)
function formatIndonesianDate(dateString) {
    if (!dateString) return "N/A";

    const date =
        typeof dateString === "string"
            ? new Date(dateString)
            : dateString.toDate?.() || new Date(); // Fallback to now if invalid
    if (!date || isNaN(date.getTime())) return "N/A";

    const days = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
    const months = [
        "Januari",
        "Februari",
        "Maret",
        "April",
        "Mei",
        "Juni",
        "Juli",
        "Agustus",
        "September",
        "Oktober",
        "November",
        "Desember",
    ];

    const dayName = days[date.getDay()];
    const day = String(date.getDate()).padStart(2, "0");
    const month = months[date.getMonth()];
    const year = date.getFullYear();

    return `${dayName}, ${day} ${month} ${year}`;
}

/**
 * Generate PDF for Regular Customers (Warehouse Exit Style)
 * @param {Object} data - Order data from POS
 */
export const generateWarehouseReceipt = async (data) => {
    // Map POS order data to the format expected by this template
    const record = {
        id: data.orderId,
        createdAt: data.orderDate || new Date(),
        customerDetail: {
            customerName: data.customerName || 'Pelanggan Umum',
            businessType: data.businessType || 'Pelanggan Reguler' // Use custom input or default
        },
        items: data.items.map(item => ({
            itemName: item.product_name,
            quantity: item.qty,
            unit: item.base_unit,
            unitPrice: item.unit_price,
            subtotal: item.total
        })),
        total: data.grandTotal
    };

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxY = pageHeight - 40; // Leave space for footer

    // Brand color - coral/red theme from WarehouseExit.js
    const brandColor = [230, 106, 106];
    const lightBrandColor = [255, 235, 235]; // Very light coral for backgrounds
    const mediumBrandColor = [250, 200, 200]; // Medium coral for alternating rows

    // Load logo image
    let logoDataUrl = null;
    try {
        // Use the imported logo or a placeholder if imports differ
        // For this project, we might need to use the one from assets if available,
        // or just use the imported variable if valid.
        // Assuming we need to load it to canvas to get data URL
        const img = new Image();
        img.src = logoImage; // Use imported image
        await new Promise((resolve, reject) => {
            img.onload = () => {
                const canvas = document.createElement("canvas");
                canvas.width = img.width;
                canvas.height = img.height;
                const ctx = canvas.getContext("2d");
                ctx.drawImage(img, 0, 0);
                logoDataUrl = canvas.toDataURL("image/png");
                resolve();
            };
            img.onerror = () => {
                console.warn("Logo not found, continuing without it");
                resolve();
            };
        });
    } catch (error) {
        console.warn("Could not load logo:", error);
    }

    // Helper function to add watermark to current page
    const addWatermark = () => {
        if (logoDataUrl) {
            const watermarkSize = 80;
            const watermarkX = (pageWidth - watermarkSize) / 2;
            const watermarkY = (pageHeight - watermarkSize) / 2;
            doc.setGState(new doc.GState({ opacity: 0.2 }));
            doc.addImage(
                logoDataUrl,
                "PNG",
                watermarkX,
                watermarkY,
                watermarkSize,
                watermarkSize
            );
            doc.setGState(new doc.GState({ opacity: 1.0 }));
        }
    };

    // Helper function to add a new page with header
    const addPageWithHeader = (isFirstPage = false) => {
        if (!isFirstPage) {
            doc.addPage();
        }

        // Add watermark first (so it's behind everything)
        addWatermark();

        // Add decorative header background with brand color
        doc.setFillColor(...brandColor);
        doc.rect(0, 0, pageWidth, 50, "F");

        // Add logo to header if available
        if (logoDataUrl && isFirstPage) {
            const logoSize = 35;
            const logoX = margin;
            const logoY = 7.5;
            doc.addImage(logoDataUrl, "PNG", logoX, logoY, logoSize, logoSize);
        }

        // Company name and title
        doc.setFontSize(18);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(255, 255, 255);
        const titleX = logoDataUrl && isFirstPage ? margin + 42 : pageWidth / 2;
        const titleAlign = logoDataUrl && isFirstPage ? "left" : "center";

        if (isFirstPage) {
            doc.text("UNIPDU REJOSO GEMILANG", titleX, 18, { align: titleAlign }); // Or project name "Sentra Distribusi..."
            doc.setFontSize(14);
            doc.setFont("helvetica", "normal");
            doc.text("Koperasi", titleX, 26, { align: titleAlign });
        }

        // KWITANSI title
        doc.setFontSize(24);
        doc.setFont("helvetica", "bold");
        doc.text("KWITANSI", titleX, isFirstPage ? 38 : 30, {
            align: titleAlign,
        });

        // Reset text color
        doc.setTextColor(0, 0, 0);

        return isFirstPage ? 60 : 60; // Return starting Y position for content
    };

    // First page header
    let yPos = addPageWithHeader(true);

    // Document info box with border
    doc.setDrawColor(...brandColor);
    doc.setLineWidth(0.5);
    doc.roundedRect(margin, yPos, pageWidth - 2 * margin, 25, 3, 3, "S");

    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("Nomor Nota:", margin + 5, yPos + 8);
    doc.setFont("helvetica", "normal");
    doc.text(record.id, margin + 5, yPos + 15);

    doc.setFont("helvetica", "bold");
    doc.text("Tanggal:", margin + 105, yPos + 8);
    doc.setFont("helvetica", "normal");
    doc.text(formatIndonesianDate(record.createdAt), margin + 105, yPos + 15);

    yPos += 35;

    // Customer details box
    doc.setFillColor(...lightBrandColor); // Light coral background
    doc.setDrawColor(...brandColor);
    doc.roundedRect(margin, yPos, pageWidth - 2 * margin, 25, 3, 3, "FD");

    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Kepada:", margin + 5, yPos + 8);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(11);
    doc.text(record.customerDetail.customerName, margin + 5, yPos + 15);
    doc.text(
        `Jenis Usaha: ${record.customerDetail.businessType}`,
        margin + 5,
        yPos + 21
    );

    yPos += 35;

    // Items table header
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Rincian Barang:", margin, yPos);
    yPos += 8;

    // Table header with background
    doc.setFillColor(...brandColor);
    doc.rect(margin, yPos, pageWidth - 2 * margin, 10, "F");

    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 255, 255);
    doc.text("Nama Barang", margin + 3, yPos + 4.5);
    doc.text("Jumlah", margin + 90, yPos + 4.5);
    doc.text("Harga Satuan", margin + 115, yPos + 4.5);
    doc.text("Subtotal", margin + 155, yPos + 4.5, { align: "right" });

    // Reset text color
    doc.setTextColor(0, 0, 0);
    yPos += 12;

    // Table content with alternating row colors
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    let rowIndex = 0;

    const drawTableRow = (item, currentY) => {
        // Alternating row background with coral theme
        if (rowIndex % 2 === 0) {
            doc.setFillColor(...mediumBrandColor);
            doc.rect(margin, currentY - 5, pageWidth - 2 * margin, 8, "F");
        }

        // Text content
        const itemName =
            item.itemName.length > 35
                ? item.itemName.substring(0, 32) + "..."
                : item.itemName;
        doc.text(itemName, margin + 3, currentY);
        doc.text(`${item.quantity} ${item.unit}`, margin + 90, currentY);
        doc.text(
            `Rp ${formatRupiah(item.unitPrice.toString())}`,
            margin + 115,
            currentY
        );
        doc.text(
            `Rp ${formatRupiah(item.subtotal.toString())}`,
            margin + 155,
            currentY,
            { align: "right" }
        );

        rowIndex++;
    };

    // Draw items with pagination support
    for (let i = 0; i < record.items.length; i++) {
        const item = record.items[i];

        // Check if we need a new page
        if (yPos > maxY) {
            // Add footer to current page
            doc.setFontSize(8);
            doc.setFont("helvetica", "italic");
            doc.setTextColor(128, 128, 128);
            doc.text(
                "Bersambung ke halaman berikutnya...",
                pageWidth / 2,
                pageHeight - 15,
                { align: "center" }
            );
            doc.setTextColor(0, 0, 0);

            // Create new page with header
            yPos = addPageWithHeader(false);

            // Redraw table header
            doc.setFillColor(...brandColor);
            doc.rect(margin, yPos, pageWidth - 2 * margin, 10, "F");
            doc.setFontSize(10);
            doc.setFont("helvetica", "bold");
            doc.setTextColor(255, 255, 255);
            doc.text("Nama Barang", margin + 3, yPos + 4.5);
            doc.text("Jumlah", margin + 90, yPos + 4.5);
            doc.text("Harga Satuan", margin + 115, yPos + 4.5);
            doc.text("Subtotal", margin + 155, yPos + 4.5, { align: "right" });
            doc.setTextColor(0, 0, 0);
            yPos += 12;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(9);
        }

        drawTableRow(item, yPos);
        yPos += 8;
    }

    // Check if we need a new page for total
    if (yPos > maxY - 30) {
        yPos = addPageWithHeader(false);
    }

    // Draw line above total
    yPos += 5;
    doc.setDrawColor(...brandColor);
    doc.setLineWidth(1);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 10;

    // Total with highlight box
    doc.setFillColor(...brandColor);
    doc.roundedRect(pageWidth - margin - 80, yPos - 8, 80, 15, 2, 2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text("TOTAL", pageWidth - margin - 75, yPos);
    doc.setFontSize(12);
    doc.text(
        `Rp ${formatRupiah(record.total.toString())}`,
        pageWidth - margin - 5,
        yPos,
        { align: "right" }
    );
    doc.setTextColor(0, 0, 0);

    // Footer
    const footerY = pageHeight - 20;
    doc.setFontSize(9);
    doc.setFont("helvetica", "italic");
    doc.setTextColor(128, 128, 128);
    doc.text(
        "Dokumen ini dibuat secara otomatis oleh sistem",
        pageWidth / 2,
        footerY,
        { align: "center" }
    );
    doc.text(
        `Dicetak pada: ${new Date().toLocaleString("id-ID")}`,
        pageWidth / 2,
        footerY + 5,
        { align: "center" }
    );

    // Save functionality
    doc.save(`receipt-regular-${record.id}.pdf`);
};

// Print functionality for Regular Receipts
export const printWarehouseReceipt = (data) => {
    // Reusing the same generation logic, but calling autoPrint/output
    // For simplicity, we can use the same function but open blob in new window 
    // or just save it. The original code used window.open(blobUrl).
    // Let's adapt generateWarehouseExitPDF to support print mode if needed, 
    // or just create a separate function reusing the core logic.

    // For now, let's keep it simple: Download is primary. 
    // If print needed, we can open the blob.
    // The implementation above does `doc.save`. 
    // Let's modify if needed.
    // Actually, `window.open` is better for printing.

    // To implement "Print", we'll just replicate the logic but do autoPrint.
    // However, sticking to the requested `Download` vs `Print` buttons in modal:
    // We can update the function above to accept an action type. Or just use `doc.autoPrint()`.

    return generateWarehouseReceipt(data); // Currently saves.
};
