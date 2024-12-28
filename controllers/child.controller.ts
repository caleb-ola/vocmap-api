import config from "../config";
import BadRequestError from "../errors/badRequest.error";
import NotAuthorizedError from "../errors/notAuthorized.error";
import { CustomRequest } from "../middlewares/middleware.types";
import Child from "../models/child.model";
import User from "../models/user.model";
import EmailService from "../services/Email.service";
import APIFeatures from "../utils/apiFeatures";
import AsyncHandler from "../utils/asyncHandler";

export const createChild = AsyncHandler(
  async (req: CustomRequest, res, next) => {
    const { currentUser } = req;
    if (!currentUser)
      throw new NotAuthorizedError(
        "You are not authorized to perform this action"
      );

    const { name, nickname, dob, gender, partnerParent } = req.body;

    const newChild = new Child({
      name,
      nickname,
      dob,
      gender,
      parent: currentUser.id,
      partnerParent,
    });

    await newChild.save();

    const user = await User.findById(currentUser.id);
    if (!user) throw new BadRequestError("Parent not found");

    user.children.push(newChild.id);
    await user.save();

    res.status(201).json({
      status: "success",
      data: {
        data: newChild,
      },
    });
  }
);

export const getAllChildren = AsyncHandler(
  async (req: CustomRequest, res, next) => {
    const { currentUser } = req;
    if (!currentUser)
      throw new NotAuthorizedError(
        "You are not authorized to perform this action"
      );

    const child = Child.find({ parent: currentUser.id }); // Remove await so it doesn't get resolved into an array before being passed into API FEATURES

    const features = new APIFeatures(child, req.query)
      .filter()
      .sort()
      .paginate()
      .limitFields();

    const childQuery = await features.query;

    res.status(200).json({
      status: "success",
      results: childQuery.length,
      data: {
        data: childQuery,
      },
    });
  }
);

export const getChild = AsyncHandler(async (req: CustomRequest, res, next) => {
  const { currentUser } = req;
  if (!currentUser)
    throw new BadRequestError("You are not authorized to perform this action.");

  const { id } = req.params;

  const child = await Child.findOne({
    _id: id,
    parent: currentUser.id,
  })
    .populate("parent", "name username email")
    .populate("partnerParent", "name username email");
  if (!child) throw new BadRequestError("Child not found");

  res.status(200).json({
    status: "success",
    data: {
      data: child,
    },
  });
});

export const updateChild = AsyncHandler(
  async (req: CustomRequest, res, next) => {
    const { currentUser } = req;
    if (!currentUser)
      throw new BadRequestError(
        "You are not authorized to perform this action"
      );

    const { id } = req.params;
    const { name, nickname, dob, gender, partnerParent } = req.body;

    const child = await Child.findOne({ _id: id, parent: currentUser.id });
    if (!child)
      throw new BadRequestError("You are not allowed to perform this action");

    if (name) child.name = name;
    if (nickname) child.nickname = nickname;
    if (dob) child.dob = dob;
    if (gender) child.gender = gender;
    if (partnerParent) child.partnerParent = partnerParent;

    await child.save();

    res.status(200).json({
      status: "success",
      data: {
        data: child,
      },
    });
  }
);

export const deleteChild = AsyncHandler(
  async (req: CustomRequest, res, next) => {
    const { currentUser } = req;
    if (!currentUser)
      throw new BadRequestError(
        "You are not authorized to perform this action"
      );

    const { id } = req.params;

    const child = await Child.findOneAndDelete({
      _id: id,
      parent: currentUser.id,
    });
    if (!child)
      throw new BadRequestError("You are not allowed to perform this action");

    res.status(204).json({
      status: "success",
    });
  }
);

export const createPartnerRequest = AsyncHandler(
  async (req: CustomRequest, res, next) => {
    const { currentUser } = req;
    const { id } = req.params;

    const { name, email } = req.body;
    if (!email) throw new BadRequestError("Email is required.");
    if (!name) throw new BadRequestError("Name is required.");

    // Get child and ensure current user is the parent of the child
    const child = await Child.findOne({ _id: id, parent: currentUser.id });
    if (!child)
      throw new NotAuthorizedError(
        "You are not allowed to perform this action."
      );

    // Check if child already has partner attached,
    // if so ask user to delete partner first before requesting to add new partner
    if (child.partnerParent)
      throw new BadRequestError(
        "Partner parent already exists, delete current partner parent before adding new partner."
      );

    // Check if partner request is already exisiting on the child
    const exisitingRequest = child.partnerRequests.find(
      (request) => request.email === email && request.status === "pending"
    );
    if (exisitingRequest)
      throw new BadRequestError(
        "A partner request with this email already exists"
      );

    // Add the partner request
    child.partnerRequests.push({
      name,
      email,
      status: "pending",
    });
    const updatedChild = await child.save();

    const requestId =
      updatedChild.partnerRequests[updatedChild.partnerRequests.length - 1].id;

    // Send Email Request to the partner
    const url = `${config.APP_CLIENT}/children/${id}/add-partner/${requestId}`;

    const partnerDetails = {
      name,
      email,
      parentName: currentUser.name,
      childName: child.name,
    };

    await new EmailService(currentUser, url).sendPartnerInvitation(
      partnerDetails
    );

    res.status(201).json({
      status: "success",
      data: {
        data: child,
      },
    });
  }
);

export const acceptPartnerRequest = AsyncHandler(
  async (req: CustomRequest, res, next) => {
    const { currentUser } = req;
    const { childId, requestId } = req.params;

    const child = await Child.findOneAndUpdate(
      {
        _id: childId,
        "partnerRequests._id": requestId,
        "partnerRequests.email": currentUser.email,
        "partnerRequests.status": "pending",
      },
      {
        $set: { "partnerRequests.$.status": "accepted" },
      },
      {
        new: true,
      }
    );
    if (!child)
      throw new NotAuthorizedError(
        "You are not allowed to perform this action"
      );

    // Delete all other requests once a request is accepted
    child.partnerParent = requestId;
    child.partnerRequests = [];
    await child.save();

    // Update Parent
    await User.findOneAndUpdate(
      { _id: child.parent },
      {
        $push: { partners: { partner: currentUser.id, child: childId } },
      }
    );

    // Update partner parent
    await User.findOneAndUpdate(
      { _id: currentUser.id },
      {
        $push: { partners: { partner: child.parent, child: childId } },
      }
    );

    res.status(200).json({
      status: "success",
      message: `You are now a partner for ${child.name}'s profile.`,
    });
  }
);

export const rejectPartnerRequest = AsyncHandler(
  async (req: CustomRequest, res, next) => {
    const { childId, requestId } = req.params;
    const { currentUser } = req;

    const child = await Child.findOneAndUpdate(
      {
        _id: childId,
        "partnerRequests._id": currentUser.id,
        "partnerRequests.email": currentUser.email,
        "partnerRequests.status": "pending",
      },
      {
        $set: { "partnerRequests.$.status": "rejected" },
      },
      {
        new: true,
      }
    );

    if (!child)
      throw new BadRequestError("You are not allowed to perform this action");

    res.status(200).json({
      status: "success",
      message: "Partner request rejected successfully",
    });
  }
);

export const removePartnerFromChild = AsyncHandler(
  async (req, res, next) => {}
);

export const resendPartnerRequest = AsyncHandler(async (req, res, next) => {});