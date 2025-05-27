import { asyncHandler } from "../utils/asyncHandler.js";
import { ApiError } from "../utils/ApiError.js";
import { User } from "../models/user.model.js";
import {
  uploadOnCloudinary,
  deleteFromCloudinary,
} from "../utils/cloudinary.js";
import { ApiResponse } from "../utils/ApiResponse.js";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";

const generateAccessAndRefreshToken = async (userId) => {
  try {
    const user = await User.findById(userId);
    if (!user) throw new ApiError(404, "User not found");

    const accessToken = user.generateAccessToken();
    const refreshToken = user.generateRefreshToken();

    user.refreshToken = refreshToken;
    await user.save({ validateBeforeSave: false });
    return { accessToken, refreshToken };
  } catch (error) {
    throw new ApiError(
      500,
      "Something went wrong while access and refresh token"
    );
  }
};
// user registration
const registerUser = asyncHandler(async (req, res) => {
  const { fullname, email, username, password } = req.body;
  // validation

  if (
    [fullname, email, username, password].some((field) => field?.trim() === "")
  ) {
    throw new ApiError(400, "All fields are required");
  }
  const existedUser = await User.findOne({
    $or: [{ username }, { email }],
  });
  if (existedUser) {
    throw new ApiError(
      409,
      "User with email or username already exists, Try different"
    );
  }

  console.warn(req.files);
  const avatarLocalPath = req.files?.avatar?.[0]?.path;
  const coverLocalPath = req.files?.coverImage?.[0]?.path;
  if (!avatarLocalPath) {
    throw new ApiError(400, "Avatar file is missing");
  }

  //   const avatar = await uploadOnCloudinary(avatarLocalPath);
  //   let coverImage = "";
  //   if (coverLocalPath) {
  //     coverImage = await uploadOnCloudinary(coverLocalPath);
  //   }

  let avatar;
  try {
    avatar = await uploadOnCloudinary(avatarLocalPath);
    console.log("Uploaded avatar", avatar);
  } catch (error) {
    console.log("Error uploading avatar", error);

    throw new ApiError(400, "Failed to to upload avatar");
  }

  let coverImage;
  try {
    coverImage = await uploadOnCloudinary(coverLocalPath);
    console.log("Uploaded cover Image", coverImage);
  } catch (error) {
    console.log("Error uploading cover image", error);

    throw new ApiError(400, "Failed to to upload cover image");
  }

  try {
    const user = await User.create({
      fullname,
      avatar: avatar.url,
      coverImage: coverImage?.url || "",
      email,
      password,
      username: username.toLowerCase(),
    });

    const createdUser = await User.findById(user._id).select(
      "-password -refreshToken"
    );
    if (!createdUser) {
      throw ApiError(500, "Something went wrong while registering a user");
    }

    return res
      .status(201)
      .json(new ApiResponse(200, createdUser, "User registered successfully"));
  } catch (error) {
    console.log("User Creation failed");

    if (avatar) {
      await deleteFromCloudinary(avatar.public_id);
    }
    if (coverImage) {
      await deleteFromCloudinary(coverImage.public_id);
    }
    throw ApiError(
      500,
      "Something went wrong while registering a user were images deleted"
    );
  }
});

const loginUser = asyncHandler(async (req, res) => {
  // get data from body
  const { email, username, password } = req.body;

  // validation
  if (!email) {
    throw new ApiError(400, " Email is required");
  }

  const user = await User.findOne({
    $or: [{ username }, { email }],
  });
  if (!user) {
    throw new ApiError(404, "User doesn't exists");
  }
  // check password
  const isPasswordValid = await user.isPasswordCorrect(password);
  if (!isPasswordValid) {
    throw new ApiError(401, "Invalid password");
  }
  // generate access and refresh token
  const { accessToken, refreshToken } = await generateAccessAndRefreshToken(
    user._id
  );

  const loggedInUser = await User.findById(user._id).select(
    "-password -refreshToken"
  );

  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };

  return res
    .status(200)
    .cookie("accessToken", accessToken, options)
    .cookie("refreshToken", refreshToken, options)
    .json(
      new ApiResponse(
        200,
        { user: loggedInUser, accessToken, refreshToken },
        "User logged in successfully"
      )
    );
});

const logoutUser = asyncHandler(async (req, res) => {
  await User.findByIdAndUpdate(
    // TODO: need to come back here aafter middleware

    req.user._id,
    {
      $set: {
        refreshToken: undefined,
      },
    },
    { new: true }
  );
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  };
  return res
    .status(200)
    .clearCookie("accessToken", options)
    .clearCookie("refreshToken", options)
    .json(new ApiError(200, "User logged out successfully"));
});

const refreshAccessToken = asyncHandler(async (req, res) => {
  const incomingRefreshToken = req.cookie.refreshToken || req.body.refreshToken;
  if (!incomingRefreshToken) {
    throw new ApiError(4001, "Refresh token is required");
  }

  try {
    const decodedToken = jwt.verify(
      incomingRefreshToken,
      process.env.REFRESH_TOKEN_SECRET
    );
    const user = await User.findById(decodedToken?._id);
    if (!user) {
      throw new ApiError(401, "Invalid refresh token");
    }

    if (incomingRefreshToken != user?.refreshToken) {
      throw new ApiError(401, "Invalid refresh token");
    }

    const options = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
    };
    const { accessToken, refreshToken, newRefreshToken } =
      await generateAccessAndRefreshToken(user._id);

    return res
      .status(200)
      .cookie("accessToken", accessToken, options)
      .cookie("refreshToken", newRefreshToken, options)
      .json(
        new ApiResponse(
          200,
          {
            accessToken,
            refreshToken: newRefreshToken,
          },
          "Access token refreshed successfully"
        )
      );
  } catch (error) {
    throw new ApiError(
      500,
      "Something went wrong while refreshing access token"
    );
  }
});

// For changing or updating the current user password
const changeCurrentPassword = asyncHandler(async (req, res) => {
  const { oldPassword, newPassword } = req.body;

  const user = await User.findById(req.user?._id);

  const isPasswordValid = await user.isPasswordCorrect(oldPassword);

  if (!isPasswordValid) {
    throw new ApiError(401, " Old Password is incorrect");
  }

  user.password = newPassword;
  await user.save({ validateBeforeSave: false });

  return res
    .status(200)
    .json(new ApiError(200, {}, "Password updated successfully"));
});

const getCurrentUser = asyncHandler(async (req, res) => {
  return res
    .status(200)
    .json(new ApiResponse(200, req.user, "Current user details fetched"));
});

const updateAccountDetails = asyncHandler(async (req, res) => {
  const { fullname, email } = req.body;

  if (!fullname || !email) {
    throw new ApiError(400, "Fullname and email are required");
  }
  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        fullname,
        email: email,
      },
    },
    { new: true }
  ).select("-password -refreshToken");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Account details updated successfully"));
});

const updateUserAvatar = asyncHandler(async (req, res) => {
  const avatarLocalPath = req.file?.path;

  if (!avatarLocalPath) {
    throw new ApiError(400, "File is required");
  }

  const avatar = await uploadOnCloudinary(avatarLocalPath);

  if (!avatar.url) {
    throw new ApiError(500, "Something went wrong while uploading avatar");
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        avatar: avatar.url,
      },
    },
    { new: true }
  ).select("-password -refreshToken");

  return res
    .status(200)
    .json(new ApiResponse(200, user, "Avatar updated successfully"));
});

const updateUserCoverImage = asyncHandler(async (req, res) => {
  const coverLocalPath = req.file?.path;

  if (!coverLocalPath) {
    throw new ApiError(400, "File is required");
  }
  const coverImage = await uploadOnCloudinary(coverLocalPath);

  if (!coverImage.url) {
    throw new ApiError(
      500,
      " Something went wrong while uploading cover image"
    );
  }

  const user = await User.findByIdAndUpdate(
    req.user?._id,
    {
      $set: {
        coverImage: coverImage.url,
      },
    },
    { new: true }
  ).select("-password -refreshToken");
  return res
    .status(200)
    .json(new ApiResponse(200, user, "Cover image updated successfully"));
});

const getUsersChannelsProfile = asyncHandler(async (req, res) => {
  const { username } = req.prams;

  if (!username?.trim()) {
    throw new ApiError(400, "username is required");
  }
  const channel = await User.aggregate([
    {
      $match: {
        username: username?.toLowerCase(),
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "channel",
        as: "subscribers",
      },
    },
    {
      $lookup: {
        from: "subscriptions",
        localField: "_id",
        foreignField: "subscriber",
        as: "subscribedTo",
      },
    },
    {
      $addFields: {
        subscribersCount: { $size: "$subscribers" },
      },
    },
    {
      $addFields: {
        channelSubscribedToCount: { $size: "$subscribedTo" },
        isSubscribed: {
          $cond: {
            if: { $in: [req.user?._id, "$subscribers.subscriber"] },
          },
        },
      },
    },
    {
      // Project only the necessary data
      $project: {
        fullname: 1,
        username: 1,
        avatar: 1,
        coverImage: 1,
        subscribersCount: 1,
        channelSubscribedToCount: 1,
        isSubscribed: 1,
        email: 1,
      },
    },
  ]);

  if (!channel?.length) {
    throw new ApiError(404, "Channel not found");
  }

  return res
    .status(200)
    .json(
      new ApiResponse(200, channel[0], "Channel profile fetched successfully")
    );
});

const getWatchHistory = asyncHandler(async (req, res) => {
  const user = await User.aggregate([
    {
      $match: {
        _id: new mongoose.Types.ObjectId.createFromHexString(req.user?._id),
      },
    },
    {
      $lookup: {
        from: " videos",
        localField: "watchHistory",
        foreignField: "_id",
        as: "watchHistory",
        pipeline:[
          {
            $lookup: {
              from: "users",
              localField: "owner",
              foreignField: "_id",
              as: " owner",
              pipeline: [
                {
                  $project: {
                    fullname: 1,
                    username: 1,
                    avatar: 1,
                  }
                }
              ]
            }
          },
          {
            $addFields: {
              owner: {
                $first: "$owner"
              }
            }
          }
        ]
      },
    },
  ]);

  return res
    .status(200)
    .json(
      new ApiResponse(200, user[0]?.watchHistory, "Watch history fetched successfully")
    );
});

export {
  registerUser,
  loginUser,
  refreshAccessToken,
  logoutUser,
  updateUserCoverImage,
  updateUserAvatar,
  getCurrentUser,
  changeCurrentPassword,
  updateAccountDetails,
  getUsersChannelsProfile,
  getWatchHistory,
};
