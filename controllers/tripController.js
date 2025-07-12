const axios = require("axios");
const { Trip, validateCreateTrip } = require("../models/trip");
const { Driver } = require("../models/Driver");
const { User } = require("../models/User");
const admin = require("../config/firebase");

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

const getAddressFromCoordinates = async (lat, lng) => {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&key=${GOOGLE_MAPS_API_KEY}&language=ar`;
  const res = await axios.get(url);
  return res.data.results?.[0]?.formatted_address || "عنوان غير معروف";
};

function getDistanceFromLatLonInMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = deg2rad(lat2 - lat1);
  const dLon = deg2rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(lat1)) *
      Math.cos(deg2rad(lat2)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function deg2rad(deg) {
  return deg * (Math.PI / 180);
}

const createTrip = async (req, res) => {
  const { error } = validateCreateTrip(req.body);
  if (error) return res.status(400).json({ error: error.details[0].message });

  const {
    userId,
    rideType,
    price,
    startLat,
    startLng,
    destinationLat,
    destinationLng,
    fname,
    lname,
    phone,
    startText,
    destinationText,
  } = req.body;

  try {
    const [pickupAddress, destinationAddress] = await Promise.all([
      startText
        ? Promise.resolve(startText)
        : getAddressFromCoordinates(startLat, startLng),
      destinationText
        ? Promise.resolve(destinationText)
        : getAddressFromCoordinates(destinationLat, destinationLng),
    ]);

    const trip = new Trip({
      user: userId,
      rideType,
      price,
      startLocation: {
        type: "Point",
        coordinates: [parseFloat(startLng), parseFloat(startLat)],
      },
      destinationLocation: {
        type: "Point",
        coordinates: [parseFloat(destinationLng), parseFloat(destinationLat)],
      },
      startText: pickupAddress,
      destinationText: destinationAddress,
      fname,
      lname,
      phone,
      isAccepted: false,
      status: "pending",
    });

    await trip.save();

    const drivers = await Driver.find({
      isVerified: true,
      fcmToken: { $ne: null },
    });

    const driversWithinRange = drivers
      .map((driver) => {
        const [driverLng, driverLat] = driver.location.coordinates;
        const distance = getDistanceFromLatLonInMeters(
          startLat,
          startLng,
          driverLat,
          driverLng
        );
        return { driver, distance };
      })
      .filter((d) => d.distance <= 5000);
    console.log("🚕 السائقين القريبين من الرحلة:");
    driversWithinRange.forEach(({ driver, distance }) => {
      console.log(`- الاسم: ${driver.firstname} ${driver.lastname}`);
      console.log(`  نوع العربية: ${driver.carType}`);
      console.log(`  المسافة: ${(distance / 1000).toFixed(2)} كم`);
    });

    const tokens = driversWithinRange
      .filter(({ driver }) => driver._id.toString() !== userId) // استبعاد السائق اللي IDه زي ID الراكب
      .map((d) => d.driver.fcmToken)
      .filter(Boolean);
    if (tokens.length) {
      const message = {
        notification: {
          title: "طلب رحلة جديد",
          body: `راكب طلب رحلة ${
            rideType === "economic" ? "اقتصادية" : "فاخرة"
          }`,
        },
        data: {
          route: "/homeDriver",
          tripId: trip._id.toString(),
          rideType,
          userId,
          price: price.toString(),
          startLat: startLat.toString(),
          startLng: startLng.toString(),
          destinationLat: destinationLat.toString(),
          destinationLng: destinationLng.toString(),
          startText: pickupAddress,
          destinationText: destinationAddress,
          fname,
          lname,
          phone,
        },
        tokens,
      };

      admin
        .messaging()
        .sendEachForMulticast(message)
        .then(() => console.log("✅ إشعارات الرحلة أُرسلت"))
        .catch((err) => console.error("❌ فشل في إرسال إشعارات الرحلة:", err));
    }

    return res.status(201).json({
      status: "success",
      tripId: trip._id.toString(),
      message: "تم إرسال الإشعارات وإنشاء الرحلة بنجاح",
      trip,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "حدث خطأ أثناء معالجة الرحلة" });
  }
};

const getTripsByUser = async (req, res) => {
  const userId = req.params.userId;

  try {
    const trips = await Trip.find({ user: userId })
      .sort({ createdAt: -1 })
      .populate("driver", "firstname lastname carType carNumber image")
      .populate("user", "fname lname email");

    return res.status(200).json(trips);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "حدث خطأ أثناء جلب الرحلات" });
  }
};

const offerTrip = async (req, res) => {
  const { tripId, driverId, price } = req.body;

  try {
    const trip = await Trip.findById(tripId);
    if (!trip) {
      return res.status(404).json({ error: "الرحلة غير موجودة" });
    }

    if (trip.driver !== null || trip.isAccepted === true) {
      return res
        .status(400)
        .json({ error: "تم اختيار سائق بالفعل لهذه الرحلة" });
    }

    const alreadyOffered = trip.interestedDrivers.some(
      (d) => d.driverId?.toString() === driverId
    );
    if (alreadyOffered) {
      return res.status(400).json({ error: "قدمت عرض مسبقًا لهذه الرحلة" });
    }

    // ✅ أضف العرض
    trip.interestedDrivers.push({ driverId, price });
    await trip.save();

    const [user, driver] = await Promise.all([
      User.findById(trip.user),
      Driver.findById(driverId),
    ]);

    if (!driver) {
      return res.status(404).json({ error: "السائق غير موجود" });
    }

    if (user?.fcmToken) {
      await admin.messaging().send({
        notification: {
          title: "سائق قدم عرضًا لرحلتك",
          body: `السائق ${driver.firstname || ""} قدم عرض بـ ${price} جنيه`,
        },
        data: {
          route: "/tripStatus",
          tripId: trip._id?.toString() || "",
          driverId: driver._id?.toString() || "",
          firstname: driver.firstname?.toString() || "",
          lastname: driver.lastname?.toString() || "",
          carType: driver.carType?.toString() || "",
          carNumber: driver.carNumber?.toString() || "",
          phone: driver.phone?.toString() || "",
          price: price?.toString() || "", // ✅ فقط price
        },
        token: user.fcmToken,
      });
    }

    return res
      .status(200)
      .json({ status: "success", message: "تم إرسال عرضك بنجاح" });
  } catch (err) {
    console.error("❌ Error in offerTrip:", err);
    return res.status(500).json({ error: "حدث خطأ أثناء إرسال العرض" });
  }
};

const selectDriver = async (req, res) => {
  const { tripId, driverId, userId } = req.body;

  if (!tripId || !driverId || !userId) {
    return res
      .status(400)
      .json({ error: "tripId و driverId و userId مطلوبين" });
  }

  try {
    const trip = await Trip.findById(tripId);
    if (!trip || trip.isAccepted) {
      return res.status(400).json({ error: "الرحلة غير متاحة" });
    }

    if (trip.user.toString() !== userId) {
      return res
        .status(403)
        .json({ error: "أنت غير مصرح لك باختيار السائق لهذه الرحلة" });
    }

    const driverOffer = trip.interestedDrivers.find(
      (d) => d.driverId.toString() === driverId
    );

    if (!driverOffer || typeof driverOffer.price === "undefined") {
      return res.status(400).json({ error: "العرض غير صالح" });
    }

    trip.driver = driverId;
    trip.isAccepted = true;
    trip.status = "accepted";
    trip.price = driverOffer.price;
    trip.interestedDrivers = [];

    await trip.save();

    // 🟢 إرسال إشعار إلى السائق اللي تم اختياره
    const [driver, user] = await Promise.all([
      Driver.findById(driverId),
      User.findById(userId),
    ]);

    if (!driver || !user) {
      return res.status(404).json({ error: "السائق أو الراكب غير موجود" });
    }

    // 🟢 بناء بيانات الرحلة
    const tripData = {
      _id: trip._id.toString(),
      price: trip.price,
      startText: trip.startText || "",
      destinationText: trip.destinationText || "",
      startLocation: trip.startLocation,
      destinationLocation: trip.destinationLocation,
      fname: user.fname || "",
      lname: user.lname || "",
      phone: user.phone || "",
      isAccepted: true, // ✅ أضف حالة القبول
      driver: driverId.toString(), // ✅ أضف الـ driver الحالي
    };

    const driverLocation = {
      lat: driver.location?.coordinates?.[1] ?? "",
      lng: driver.location?.coordinates?.[0] ?? "",
    };

    // 🟢 إرسال FCM Notification
    await admin.messaging().send({
      notification: {
        title: "تم اختيارك للرحلة",
        body: `راكب اختارك لرحلة بسعر ${driverOffer.price} جنيه`,
      },
      data: {
        route: "/acceptedTrip",
        tripId: trip._id.toString(),
        price: driverOffer.price.toString(),
        trip: JSON.stringify(tripData),
        driverLocation: JSON.stringify(driverLocation),
      },
      token: driver.fcmToken,
    });

    console.log("📩 تم إرسال إشعار إلى السائق المختار");

    return res.status(200).json({
      status: "success",
      message: "تم اختيار السائق وإرسال الإشعار",
      trip,
      driverLocation,
      driver,
    });
  } catch (err) {
    console.error("❌ selectDriver error:", err);
    return res.status(500).json({ error: "خطأ أثناء اختيار السائق" });
  }
};

const refuseTrip = async (req, res) => {
  const { tripId } = req.body;
  try {
    const trip = await Trip.findById(tripId);
    if (!trip)
      return res.status(404).json({ error: "لم يتم العثور على الرحلة" });

    if (trip.status === "cancelled") {
      return res.status(400).json({ error: "الرحلة ملغاة بالفعل" });
    }

    trip.status = "cancelled";
    await trip.save();

    const user = await User.findById(trip.user);
    if (user?.fcmToken) {
      await admin.messaging().send({
        notification: {
          title: "تم إلغاء الرحلة",
          body: "قام السائق بإلغاء الرحلة. يمكنك طلب رحلة جديدة الآن.",
        },
        data: { route: "/home" },
        token: user.fcmToken,
      });
    }

    await trip.deleteOne();

    return res.status(200).json({
      status: "success",
      message: "تم إلغاء الرحلة وحذفها بنجاح",
    });
  } catch (err) {
    console.error("❌ Error in refuseTrip:", err);
    return res.status(500).json({ error: "حدث خطأ أثناء إلغاء الرحلة" });
  }
};

const sendChatNotification = async (req, res) => {
  const { receiverId, senderName, text } = req.body;

  try {
    const receiver =
      (await User.findById(receiverId)) || (await Driver.findById(receiverId));

    if (!receiver || !receiver.fcmToken) {
      return res.status(404).json({ error: "المستلم لا يملك FCM Token" });
    }

    const message = {
      notification: {
        title: `رسالة جديدة من ${senderName}`,
        body: text.length > 30 ? text.substring(0, 30) + "..." : text,
      },
      data: {
        route: "/chat",
        senderName,
        message: text,
        click_action: "FLUTTER_NOTIFICATION_CLICK", // ✅ مهم لدعم التنقل في Flutter
      },

      token: receiver.fcmToken,
    };

    // 🟢 أرسل الإشعار في الخلفية بدون تأخير الرد على العميل
    admin
      .messaging()
      .send(message)
      .then(() => console.log("✅ إشعار تم إرساله"))
      .catch((err) => console.error("❌ فشل إرسال الإشعار:", err));

    // 🔁 رجّع رد فوري للعميل
    return res.status(200).json({ message: "جاري إرسال الإشعار 🚀" });
  } catch (err) {
    console.error("❌ Error in sendChatNotification:", err);
    return res.status(500).json({ error: "فشل إرسال الإشعار" });
  }
};

module.exports = {
  createTrip,
  getTripsByUser,
  offerTrip,
  selectDriver,
  refuseTrip,
  sendChatNotification,
};
