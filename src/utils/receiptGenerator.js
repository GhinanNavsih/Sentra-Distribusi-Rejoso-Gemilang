import jsPDF from 'jspdf';
import logoImage from '../assets/Warehouse 375 logo (compress).png';

// Number to Indonesian words converter
const numberToWords = (num) => {
    const ones = ['', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan'];
    const tens = ['', '', 'Dua Puluh', 'Tiga Puluh', 'Empat Puluh', 'Lima Puluh', 'Enam Puluh', 'Tujuh Puluh', 'Delapan Puluh', 'Sembilan Puluh'];
    const teens = ['Sepuluh', 'Sebelas', 'Dua Belas', 'Tiga Belas', 'Empat Belas', 'Lima Belas', 'Enam Belas', 'Tujuh Belas', 'Delapan Belas', 'Sembilan Belas'];

    if (num === 0) return 'Nol';

    const convert = (n) => {
        if (n < 10) return ones[n];
        if (n >= 10 && n < 20) return teens[n - 10];
        if (n >= 20 && n < 100) return tens[Math.floor(n / 10)] + (n % 10 !== 0 ? ' ' + ones[n % 10] : '');
        if (n >= 100 && n < 1000) {
            const hundreds = Math.floor(n / 100);
            const remainder = n % 100;
            return (hundreds === 1 ? 'Seratus' : ones[hundreds] + ' Ratus') + (remainder !== 0 ? ' ' + convert(remainder) : '');
        }
        if (n >= 1000 && n < 1000000) {
            const thousands = Math.floor(n / 1000);
            const remainder = n % 1000;
            return (thousands === 1 ? 'Seribu' : convert(thousands) + ' Ribu') + (remainder !== 0 ? ' ' + convert(remainder) : '');
        }
        if (n >= 1000000 && n < 1000000000) {
            const millions = Math.floor(n / 1000000);
            const remainder = n % 1000000;
            return convert(millions) + ' Juta' + (remainder !== 0 ? ' ' + convert(remainder) : '');
        }
        if (n >= 1000000000) {
            const billions = Math.floor(n / 1000000000);
            const remainder = n % 1000000000;
            return convert(billions) + ' Miliar' + (remainder !== 0 ? ' ' + convert(remainder) : '');
        }
        return '';
    };

    return convert(num) + ' Rupiah';
};

export const generateReceipt = (receiptData) => {
    const {
        orderId,
        orderDate,
        items,
        grandTotal,
        customerName = '',
        paymentMethod = 'Cash',
        isCreditSale = false,
        companyInfo = {
            name: 'Sentra Distribusi Rejoso Gemilang',
            subheader: 'Unit Usaha Koperasi',
            address: 'PP Darul Ulum, Peterongan, Jombang',
            contact: '+62 857-3372-0226 (Bapak Izzul)'
        }
    } = receiptData;

    const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
        compress: true
    });

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 15;
    let yPos = margin;

    // ===== HEADER =====
    // Add Logo (Left side)
    const logoWidth = 24;
    const logoHeight = 20;
    // Use 'FAST' compression for the image
    doc.addImage(logoImage, 'PNG', margin, yPos, logoWidth, logoHeight, undefined, 'FAST');

    // Company Name and Subheader (next to logo)
    const textStartX = margin + logoWidth + 3;

    // Company Name - Dark Blue
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0, 32, 96); // Dark blue RGB
    doc.text(companyInfo.name, textStartX, yPos + 8);

    // Subheader - Dark Orange
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(204, 85, 0); // Dark orange RGB
    doc.text(companyInfo.subheader.toUpperCase(), textStartX, yPos + 14);

    // Reset text color to black
    doc.setTextColor(0, 0, 0);

    // Address and Contact (below logo and title)
    const infoY = yPos + logoHeight + 4;
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(companyInfo.address, margin, infoY);
    doc.text(companyInfo.contact, margin, infoY + 4);

    // Right Section - Title and Details
    const rightX = pageWidth - margin;
    let rightY = yPos;

    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    const title = isCreditSale ? 'INVOICE' : 'NOTA PENJUALAN';
    doc.text(title, rightX, rightY + 3, { align: 'right' });

    rightY += 10;
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`No. Nota: ${orderId}`, rightX, rightY, { align: 'right' });

    rightY += 5;
    doc.text(`Tanggal: ${orderDate}`, rightX, rightY, { align: 'right' });

    if (customerName) {
        rightY += 6;
        doc.setFont('helvetica', 'italic');
        doc.text('Kepada Yth.', rightX, rightY, { align: 'right' });
        rightY += 4;
        doc.setFont('helvetica', 'bold');
        doc.text(customerName, rightX, rightY, { align: 'right' });
    }

    // Horizontal line after header
    yPos = Math.max(infoY + 8, rightY) + 5;
    doc.setLineWidth(0.8);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 8;

    // ===== TABLE HEADER =====
    doc.setFillColor(240, 240, 240);
    doc.rect(margin, yPos - 5, pageWidth - 2 * margin, 7, 'F');

    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');

    const colNo = margin + 2;
    const colNama = margin + 12;
    const colQty = pageWidth - margin - 70;
    const colHarga = pageWidth - margin - 45;
    const colTotal = pageWidth - margin - 2;

    doc.text('No', colNo, yPos);
    doc.text('Nama Barang', colNama, yPos);
    doc.text('Qty', colQty, yPos, { align: 'right' });
    doc.text('Harga Satuan', colHarga, yPos, { align: 'right' });
    doc.text('Total', colTotal, yPos, { align: 'right' });

    yPos += 8;

    // ===== TABLE BODY =====
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);

    items.forEach((item, index) => {
        // Check if we need a new page
        if (yPos > pageHeight - 60) {
            doc.addPage();
            yPos = margin;
        }

        doc.text(`${index + 1}`, colNo, yPos);
        doc.text(item.product_name, colNama, yPos);
        doc.text(`${item.qty} ${item.base_unit}`, colQty, yPos, { align: 'right' });
        doc.text(item.unit_price.toLocaleString('id-ID'), colHarga, yPos, { align: 'right' });
        doc.text(item.total.toLocaleString('id-ID'), colTotal, yPos, { align: 'right' });

        yPos += 6;
    });

    // Line before total
    yPos += 2;
    doc.setLineWidth(0.3);
    doc.line(margin, yPos, pageWidth - margin, yPos);
    yPos += 6;

    // ===== GRAND TOTAL =====
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    // Fixed: Move label further left to prevent overlap
    doc.text('TOTAL PEMBELIAN:', pageWidth - margin - 65, yPos);
    doc.text(`Rp ${grandTotal.toLocaleString('id-ID')}`, colTotal, yPos, { align: 'right' });

    yPos += 10;

    // ===== FOOTER =====
    // Terbilang
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(9);
    const terbilang = numberToWords(grandTotal);
    doc.text(`Terbilang: ${terbilang}`, margin, yPos);

    yPos += 8;

    // Payment Method
    doc.setFont('helvetica', 'normal');
    doc.text(`Metode Pembayaran: ${paymentMethod}`, margin, yPos);

    yPos += 8;

    // Terms
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    const terms = 'Barang yang sudah dibeli tidak dapat ditukar/dikembalikan kecuali ada perjanjian khusus.\nKomplain maksimal 1x24 jam.';
    const splitTerms = doc.splitTextToSize(terms, pageWidth - 2 * margin);
    doc.text(splitTerms, margin, yPos);

    yPos += splitTerms.length * 4 + 10;

    // Signature Block
    const sigY = Math.max(yPos, pageHeight - 40);
    const sigLeftX = margin + 30;
    const sigRightX = pageWidth - margin - 30;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text('Hormat Kami,', sigLeftX, sigY, { align: 'center' });
    doc.text('Penerima,', sigRightX, sigY, { align: 'center' });

    // Signature lines
    doc.line(sigLeftX - 25, sigY + 20, sigLeftX + 25, sigY + 20);
    doc.line(sigRightX - 25, sigY + 20, sigRightX + 25, sigY + 20);

    return doc;
};

export const downloadReceipt = (receiptData) => {
    const doc = generateReceipt(receiptData);
    doc.save(`Nota_${receiptData.orderId}.pdf`);
};

export const printReceipt = (receiptData) => {
    const doc = generateReceipt(receiptData);
    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
};
