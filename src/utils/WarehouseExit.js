import React, { useState, useEffect } from "react";
import {
  FaPlus,
  FaFileInvoice,
  FaUpload,
  FaReceipt,
  FaEye,
  FaCheck,
  FaClock,
  FaExclamationTriangle,
} from "react-icons/fa";
import { v4 as uuidv4 } from "uuid";
import { jsPDF } from "jspdf";
import "../styles/WarehouseExit.css";
import { useAuth } from "../context/AuthContext";
import { useFirestore } from "../context/FirestoreContext";
import { uploadFile } from "../firebase";
import WarehouseExitModal from "./WarehouseExitModal";
import logoImage from "../assets/logo-koperasi-unipdu-removebg-preview.png";

// Helper function for currency formatting
function formatRupiah(value) {
  if (!value) return "0";
  const numeric = value.toString().replace(/\D/g, "");
  if (!numeric) return "0";
  return numeric.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

// Helper function to format date in Indonesian (EEEE, DD MM YYYY)
function formatIndonesianDate(dateString) {
  if (!dateString) return "N/A";

  const date =
    typeof dateString === "string"
      ? new Date(dateString)
      : dateString.toDate?.();
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

function parseRupiah(value) {
  if (!value) return 0;
  const numeric = value.toString().replace(/\D/g, "");
  return parseInt(numeric, 10) || 0;
}

// Helper function to convert to smallest unit (similar to Transaksi.js)
function convertToSmallestUnit(quantity, unit, product) {
  if (quantity == null || !unit || !product.smallestUnit) {
    throw new Error("Missing required parameters for conversion");
  }

  // Handle box conversion first
  if (unit === "box") {
    if (!product.piecesPerBox) {
      throw new Error("Pieces per box not defined for this product");
    }
    return quantity * product.piecesPerBox;
  }

  // For weight-based conversions
  const weightConversions = {
    ton: 1000000, // 1 ton = 1,000,000 grams
    kwintal: 100000, // 1 kwintal = 100,000 grams
    kg: 1000, // 1 kg = 1,000 grams
    ons: 100, // 1 ons = 100 grams
    gram: 1, // base unit
    pcs: 1, // for piece-based items
    kardus: 1,
    karton: 1,
    pack: 1,
  };

  // If the unit or product's smallest unit isn't in our conversion table
  if (!weightConversions[unit] || !weightConversions[product.smallestUnit]) {
    throw new Error("Invalid unit for conversion");
  }

  // Convert to grams first, then to target unit
  const valueInGrams = quantity * weightConversions[unit];
  const result = valueInGrams / weightConversions[product.smallestUnit];

  return result;
}

const WarehouseExit = () => {
  const { currentUser, userRole } = useAuth();
  const { createDoc, updateDoc, queryCollection } = useFirestore();

  const [showModal, setShowModal] = useState(false);
  const [products, setProducts] = useState({});
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploadingFiles, setUploadingFiles] = useState({});
  const [snackbar, setSnackbar] = useState({ open: false, message: "" });
  const [currentPage, setCurrentPage] = useState(1);
  const recordsPerPage = 10;

  // Check if user can create new records
  const canCreateRecord =
    userRole === "Director" ||
    userRole === "Wakil Rektor 2" ||
    userRole === "Admin" ||
    userRole === "superAdmin";
  const canUploadPO = userRole === "Mitra";
  const canUploadPayment = userRole === "BAK";

  // Fetch products from stocks_b2b
  const fetchProducts = async () => {
    try {
      const stocksData = await queryCollection("stocks_b2b");
      const productsObj = {};

      stocksData.forEach((item) => {
        if (!item.isDeleted) {
          productsObj[item.id] = {
            ...item,
            name: item.name
              .split(" ")
              .map(
                (word) =>
                  word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
              )
              .join(" "),
          };
        }
      });

      setProducts(productsObj);
    } catch (error) {
      console.error("Error fetching products:", error);
    }
  };

  // Fetch warehouse exit records
  const fetchRecords = async () => {
    try {
      const recordsData = await queryCollection("warehouseExit");
      // Sort by createdAt descending (newest first)
      const sortedRecords = recordsData.sort((a, b) => {
        const dateA =
          typeof a.createdAt === "string"
            ? new Date(a.createdAt)
            : a.createdAt?.toDate?.() || new Date(0);
        const dateB =
          typeof b.createdAt === "string"
            ? new Date(b.createdAt)
            : b.createdAt?.toDate?.() || new Date(0);
        return dateB - dateA;
      });
      setRecords(sortedRecords);
    } catch (error) {
      console.error("Error fetching records:", error);
    } finally {
      setLoading(false);
    }
  };

  // Generate document ID with format yyyy-mm-dd_timestampInSeconds
  const generateDocumentId = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    const timestampInSeconds = Math.floor(now.getTime() / 1000);
    return `${yyyy}-${mm}-${dd}_${timestampInSeconds}`;
  };

  // Handle save from modal
  const handleSave = async (transactionData, validRows) => {
    try {
      const documentId = generateDocumentId();
      const transactionDetailId = uuidv4(); // Create once for all transactions

      // Check stock availability and create stock transactions
      for (const row of validRows) {
        const product = row.product;
        const quantity = parseFloat(row.quantity);

        // Convert to smallest unit for stock calculation
        const convertedQty = convertToSmallestUnit(quantity, row.unit, {
          smallestUnit: product.smallestUnit,
          piecesPerBox: product.piecesPerBox,
        });

        // Create stock transaction (similar to Transaksi.js)
        const stockTransactionId = uuidv4();
        await createDoc(
          "stockTransactions_b2b",
          {
            itemId: product.itemId || product.id,
            itemName: product.name,
            kategori: product.kategori || "",
            subKategori: product.subKategori || "",
            price: parseRupiah(row.unitPrice),
            quantity: convertedQty,
            unit: product.smallestUnit,
            originalQuantity: quantity,
            originalUnit: row.unit,
            isDeleted: false,
            transactionType: "penjualan",
            transactionVia: "warehouseExit",
            stockWorth: (product.stockValue / product.stock) * convertedQty,
            transactionDetailId: transactionDetailId, // Reference to transaction detail
            createdBy: currentUser ? currentUser.email : "unknown",
          },
          stockTransactionId
        );

        // Update stock
        const newStock = product.stock - convertedQty;
        const stockReduction =
          (product.stockValue / product.stock) * convertedQty;
        const newStockValue = Math.max(0, product.stockValue - stockReduction);

        await updateDoc("stocks_b2b", product.id, {
          stock: newStock,
          stockValue: newStockValue,
        });
      }

      // Create transaction detail (similar to Transaksi.js)
      await createDoc(
        "transactionDetail_b2b",
        {
          id: transactionDetailId,
          items: transactionData.items,
          total: transactionData.total,
          customerDetail: transactionData.customerDetail,
          isMember: false,
          createdBy: currentUser ? currentUser.email : "unknown",
        },
        transactionDetailId
      );

      // Create warehouse exit record
      const warehouseExitData = {
        ...transactionData,
        id: documentId,
        transactionDetailId,
        createdAt: new Date().toISOString(),
      };

      await createDoc("warehouseExit", warehouseExitData, documentId);

      // Refresh data
      await fetchRecords();
      await fetchProducts();

      setSnackbar({
        open: true,
        message: "Warehouse exit record created successfully!",
      });

      setTimeout(() => {
        setSnackbar({ open: false, message: "" });
      }, 3000);
    } catch (error) {
      console.error("Error creating warehouse exit record:", error);
      throw error;
    }
  };

  // Generate quotation PDF
  const generateQuotationPDF = async (record) => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxY = pageHeight - 40; // Leave space for footer

    // Brand color - coral/red theme
    const brandColor = [230, 106, 106];
    const lightBrandColor = [255, 235, 235]; // Very light coral for backgrounds
    const mediumBrandColor = [250, 200, 200]; // Medium coral for alternating rows

    // Load logo image
    let logoDataUrl = null;
    try {
      const logoPath = "/logo koperasi URG.png";
      const img = new Image();
      img.src = process.env.PUBLIC_URL + logoPath;
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
        doc.text("UNIPDU REJOSO GEMILANG", titleX, 18, { align: titleAlign });
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

    // Open in new tab
    const pdfBlob = doc.output("blob");
    const pdfUrl = URL.createObjectURL(pdfBlob);
    window.open(pdfUrl, "_blank");
  };

  // Get status display with enhanced information
  const getStatusDisplay = (record) => {
    const { workflow } = record;

    if (workflow.uploadBuktiPembayaran?.completed) {
      return {
        text: "Selesai",
        color: "#28a745",
        bgColor: "#d4edda",
        textColor: "#155724",
        icon: <FaCheck />,
      };
    } else if (workflow.uploadPO?.completed) {
      return {
        text: "Menunggu Pembayaran",
        color: "#ffc107",
        bgColor: "#fff3cd",
        textColor: "#856404",
        icon: <FaClock />,
      };
    } else {
      return {
        text: "Menunggu PO",
        color: "#dc3545",
        bgColor: "#f8d7da",
        textColor: "#721c24",
        icon: <FaExclamationTriangle />,
      };
    }
  };

  // File upload handler with Firebase Storage
  const handleFileUpload = async (recordId, fileType, file) => {
    const uploadKey = `${recordId}_${fileType}`;

    try {
      // Set loading state
      setUploadingFiles((prev) => ({ ...prev, [uploadKey]: true }));

      // Generate file path with proper naming convention
      const timestamp = Date.now();
      const fileExtension = file.name.split(".").pop();
      const fileName = `${recordId}_${fileType}_${timestamp}.${fileExtension}`;
      const filePath = `warehouse/${fileType}/${fileName}`;

      // Upload file to Firebase Storage
      const downloadURL = await uploadFile(file, filePath);

      // Update workflow status with file information
      const updateData = {};
      if (fileType === "po") {
        updateData[`workflow.uploadPO`] = {
          completed: true,
          completedAt: new Date(),
          fileName: file.name,
          originalFileName: file.name,
          storagePath: filePath,
          downloadURL: downloadURL,
          uploadedBy: {
            email: currentUser?.email || "unknown",
            uid: currentUser?.uid || "unknown",
          },
        };
        updateData.status = "menunggu pembayaran";
      } else if (fileType === "payment") {
        updateData[`workflow.uploadBuktiPembayaran`] = {
          completed: true,
          completedAt: new Date(),
          fileName: file.name,
          originalFileName: file.name,
          storagePath: filePath,
          downloadURL: downloadURL,
          uploadedBy: {
            email: currentUser?.email || "unknown",
            uid: currentUser?.uid || "unknown",
          },
        };
        updateData.status = "completed";
      }

      await updateDoc("warehouseExit", recordId, updateData);
      await fetchRecords();

      setSnackbar({
        open: true,
        message: `${
          fileType === "po" ? "PO" : "Payment proof"
        } uploaded successfully!`,
      });

      setTimeout(() => {
        setSnackbar({ open: false, message: "" });
      }, 3000);
    } catch (error) {
      console.error("Error uploading file:", error);
      alert("Error uploading file: " + error.message);
    } finally {
      // Clear loading state
      setUploadingFiles((prev) => {
        const newState = { ...prev };
        delete newState[uploadKey];
        return newState;
      });
    }
  };

  // Handle viewing uploaded files
  const handleViewFile = (fileInfo) => {
    if (fileInfo?.downloadURL) {
      window.open(fileInfo.downloadURL, "_blank");
    } else {
      alert("File not available");
    }
  };

  useEffect(() => {
    fetchProducts();
    fetchRecords();
  }, []);

  // Calculate pagination
  const indexOfLastRecord = currentPage * recordsPerPage;
  const indexOfFirstRecord = indexOfLastRecord - recordsPerPage;
  const currentRecords = records.slice(indexOfFirstRecord, indexOfLastRecord);
  const totalPages = Math.ceil(records.length / recordsPerPage);

  const handlePageChange = (pageNumber) => {
    setCurrentPage(pageNumber);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  if (loading) {
    return <div className="warehouse-exit-loading">Memuat...</div>;
  }

  return (
    <div className="warehouse-exit-container">
      <div className="warehouse-exit-header">
        <h1>Pengiriman Barang</h1>
        {canCreateRecord && (
          <button
            className="warehouse-exit-create-btn"
            onClick={() => setShowModal(true)}
          >
            <FaPlus /> Kirim Barang
          </button>
        )}
      </div>

      <div className="warehouse-exit-records">
        {records.length === 0 ? (
          <div className="warehouse-exit-empty">
            <p>Tidak ada catatan keluar gudang ditemukan.</p>
            {canCreateRecord && (
              <button
                className="warehouse-exit-create-btn"
                onClick={() => setShowModal(true)}
              >
                <FaPlus /> Buat Catatan Pertama
              </button>
            )}
          </div>
        ) : (
          <>
            {currentRecords.map((record) => {
              const statusDisplay = getStatusDisplay(record);

              return (
                <div key={record.id} className="warehouse-exit-record-tile">
                  <div className="record-header">
                    <div className="record-main-info">
                      <div className="record-title-row">
                        <h3 className="customer-name">
                          {formatIndonesianDate(record.createdAt)} -{" "}
                          {record.customerDetail.customerName}
                        </h3>
                      </div>
                      <div className="record-metadata">
                        <span className="record-id">ID: {record.id}</span>
                      </div>
                    </div>
                    <div className="record-right-side">
                      <span
                        className="status-tag"
                        style={{
                          backgroundColor: statusDisplay.bgColor,
                          color: statusDisplay.textColor,
                          border: `1px solid ${statusDisplay.color}`,
                        }}
                      >
                        {statusDisplay.icon}
                        {statusDisplay.text}
                      </span>
                      <div className="total-price-badge">
                        Rp {formatRupiah(record.total.toString())}
                      </div>
                    </div>
                  </div>

                  <div className="action-row">
                    {/* Always show Nota Tagihan - always available */}
                    <button
                      className="action-btn completed"
                      onClick={async () => {
                        try {
                          await generateQuotationPDF(record);
                        } catch (error) {
                          console.error("Error generating PDF:", error);
                          alert("Error generating PDF. Please try again.");
                        }
                      }}
                    >
                      <FaFileInvoice /> Nota Tagihan
                    </button>

                    {/* Always show PO button with different states */}
                    {uploadingFiles[`${record.id}_po`] ? (
                      <button className="action-btn loading" disabled>
                        <div className="loading-spinner"></div> Mengunggah PO...
                      </button>
                    ) : record.workflow.uploadPO?.completed ? (
                      <button
                        className="action-btn completed"
                        onClick={() => handleViewFile(record.workflow.uploadPO)}
                      >
                        <FaEye /> Lihat PO
                      </button>
                    ) : canUploadPO ? (
                      <label className="action-btn active">
                        <FaUpload /> Upload PO
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            if (e.target.files[0]) {
                              handleFileUpload(
                                record.id,
                                "po",
                                e.target.files[0]
                              );
                            }
                          }}
                        />
                      </label>
                    ) : (
                      <button className="action-btn disabled" disabled>
                        <FaUpload /> Upload PO
                      </button>
                    )}

                    {/* Always show Payment button with different states */}
                    {uploadingFiles[`${record.id}_payment`] ? (
                      <button className="action-btn loading" disabled>
                        <div className="loading-spinner"></div> Mengunggah
                        Bukti...
                      </button>
                    ) : record.workflow.uploadBuktiPembayaran?.completed ? (
                      <button
                        className="action-btn completed"
                        onClick={() =>
                          handleViewFile(record.workflow.uploadBuktiPembayaran)
                        }
                      >
                        <FaEye /> Lihat Bukti
                      </button>
                    ) : canUploadPayment &&
                      record.workflow.uploadPO?.completed ? (
                      <label className="action-btn active">
                        <FaReceipt /> Upload Bukti
                        <input
                          type="file"
                          accept=".pdf,.jpg,.jpeg,.png"
                          style={{ display: "none" }}
                          onChange={(e) => {
                            if (e.target.files[0]) {
                              handleFileUpload(
                                record.id,
                                "payment",
                                e.target.files[0]
                              );
                            }
                          }}
                        />
                      </label>
                    ) : (
                      <button className="action-btn disabled" disabled>
                        <FaReceipt /> Upload Bukti
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="warehouse-exit-pagination">
                <button
                  className="pagination-btn"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                  style={{
                    opacity: currentPage === 1 ? 0.5 : 1,
                    cursor: currentPage === 1 ? "not-allowed" : "pointer",
                  }}
                >
                  &laquo; Previous
                </button>

                <div className="pagination-numbers">
                  {Array.from({ length: totalPages }, (_, i) => i + 1).map(
                    (pageNum) => {
                      // Show first page, last page, current page, and pages around current
                      if (
                        pageNum === 1 ||
                        pageNum === totalPages ||
                        (pageNum >= currentPage - 1 &&
                          pageNum <= currentPage + 1)
                      ) {
                        return (
                          <button
                            key={pageNum}
                            className={`pagination-number ${
                              pageNum === currentPage ? "active" : ""
                            }`}
                            onClick={() => handlePageChange(pageNum)}
                          >
                            {pageNum}
                          </button>
                        );
                      } else if (
                        pageNum === currentPage - 2 ||
                        pageNum === currentPage + 2
                      ) {
                        return (
                          <span key={pageNum} className="pagination-ellipsis">
                            ...
                          </span>
                        );
                      }
                      return null;
                    }
                  )}
                </div>

                <button
                  className="pagination-btn"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                  style={{
                    opacity: currentPage === totalPages ? 0.5 : 1,
                    cursor:
                      currentPage === totalPages ? "not-allowed" : "pointer",
                  }}
                >
                  Next &raquo;
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modal */}
      <WarehouseExitModal
        isOpen={showModal}
        onClose={() => setShowModal(false)}
        onSave={handleSave}
        products={products}
        currentUser={currentUser}
      />

      {/* Snackbar */}
      {snackbar.open && (
        <div className="warehouse-exit-snackbar">{snackbar.message}</div>
      )}
    </div>
  );
};

export default WarehouseExit;
